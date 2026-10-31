import type IOChainManager from "audiobus/io/IO-chain-manager"
import type AudioEventRecorder from "audiobus/audio-event-recorder"
import type { IAudioCommand } from "audiobus/audio-command-interface"
import { NOTE_ON, NOTE_OFF, INPUT_EVENT } from "audiobus/commands"
import {
	EVENT_CLOSE,
	EVENT_PAGE_HIDE,
	EVENT_TRANSPORT_CHANGED,
	EVENT_CHAINS_UPDATED,
	EVENT_TOGGLE,
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_WORKSPACE_RESTORED,
	EVENT_VISIBILITY_CHANGE
} from "audiobus/event-constants"
import {
	clipCommand,
	musicalCommand,
	parseEventClip,
	supportsClipCommand,
	type EventClip
} from "audiobus/io/event-clip"
import type { AudioRecording } from "./audio-recording"
import type { MidiControls } from "./midi-controls"
import { AcousticTempoFollower } from "./acoustic-tempo"
import { mountPerformanceControls, mountDiagnostics } from "./performance-tools"
import { mountChordEditor, mountRouteFinder, mountGrooveTools } from "./composition-tools"
import { mountProjectTools } from "./project-tools"
import { element, action, numberField, onChange } from "./music-tools-dom"
import { TransformerChordTrack } from "audiobus/io/transformers/transformer-chord-track"
import InputEventLoop from "audiobus/io/inputs/input-event-loop"
import InputScaleExplorer from "audiobus/io/inputs/input-scale-explorer"

export interface MusicalFeatureOptions {
	manager: IOChainManager
	context: AudioContext
	master: GainNode
	recorder: AudioEventRecorder
	recording: AudioRecording
	midi: MidiControls
	getBpm(): number
	getSwing(): number
	getNow(): number
	beatsPerBar(): number
	setTempo(bpm: number, swing?: number): void
	canFollow(): boolean
	persistMidi(value: string): void
}
/** Normalize only musical messages; event capture also contains system/transport data. */
export function capturedClip(commands: IAudioCommand[]): EventClip {
	const musical = commands.filter(supportsClipCommand)
	if (musical.length > 19000) {
		throw new Error("Capture contains too many events for a loop; capture a shorter phrase")
	}
	if (!musical.some((command) => command.type === NOTE_ON && command.velocity > 0)) {
		throw new Error("Play and capture some notes first")
	}
	const origin = Math.min(...musical.map((command) => command.startAt))
	const end = Math.max(...musical.map((command) => command.startAt))
	const duration = Math.max(0.1, end - origin + 0.1)
	const normalized = musical.map((command) => {
		const copy = clipCommand(command, command.startAt - origin)
		if (copy.channel < 1 || copy.channel > 16) {
			copy.channel = 1
		}
		return copy
	})
	return finishClip(normalized, duration)
}
function finishClip(commands: IAudioCommand[], duration: number): EventClip {
	const held = new Map<string, IAudioCommand[]>()
	for (const command of commands) {
		const key = `${command.from}:${command.channel}:${command.number}`
		if (command.type === NOTE_ON && command.velocity > 0) {
			const queue = held.get(key) ?? []
			queue.push(command)
			held.set(key, queue)
		} else if (command.type === NOTE_OFF || command.type === NOTE_ON) {
			held.get(key)?.shift()
		}
	}
	const releases = [...held.values()].flatMap((queue) =>
		queue.map((command) =>
			musicalCommand({ ...clipCommand(command, duration), type: NOTE_OFF, velocity: 0 })
		)
	)
	return parseEventClip({ version: 1, duration, commands: [...commands, ...releases] })
}
export function createMusicalFeatureControls(options: MusicalFeatureOptions) {
	const { manager, context, master } = options
	const abort = new AbortController()
	const status = element("p")
	status.setAttribute("role", "status")
	const mounts: HTMLElement[] = []
	const group = (parent: HTMLElement | null, title: string) => {
		if (!parent) {
			return undefined
		}
		const details = element("details")
		details.append(element("summary", title))
		const host = element("div")
		host.className = "context-controls"
		details.append(host)
		parent.append(details)
		mounts.push(details)
		return host
	}
	const settings = document.getElementById("settings-form")
	const diagnosticsHost = group(settings, "Sound diagnostics")
	const diagnostics = diagnosticsHost
		? mountDiagnostics(diagnosticsHost, manager, context, master, status)
		: undefined
	if (diagnosticsHost) {
		diagnosticsHost.append(status)
		diagnosticsHost.parentElement!.addEventListener(
			EVENT_TOGGLE,
			() => {
				if ((diagnosticsHost.parentElement as HTMLDetailsElement).open) {
					diagnostics?.start()
				} else {
					diagnostics?.stop()
				}
			},
			{ signal: abort.signal }
		)
	}
	const performanceHost = group(
		document.getElementById("midi-macro-controls"),
		"Control several parameters with one MIDI CC"
	)
	const performanceStatus = element("p")
	performanceStatus.setAttribute("role", "status")
	const groupedControls = element("div")
	performanceHost?.append(groupedControls, performanceStatus)
	const performance = performanceHost
		? mountPerformanceControls(groupedControls, manager, options.midi, performanceStatus)
		: undefined
	let capture:
		| {
				chainId: string
				startBeat: number
				endBeat: number
				start?: number
				owner: InputEventLoop
				commands: IAudioCommand[]
				status: HTMLElement
				resolve(clip: EventClip): void
				reject(error: Error): void
		  }
		| undefined
	let currentBeat = 0
	const getClip = () => capturedClip(options.recorder.events)
	const captureBar = (chainId: string, captureStatus: HTMLElement, owner: InputEventLoop) =>
		new Promise<EventClip>((resolve, reject) => {
			if (capture) {
				reject(new Error("A capture is already in progress"))
				return
			}
			if (!manager.transportRunning || !manager.getChain(chainId)) {
				reject(new Error("Choose a chain and start transport before capturing"))
				return
			}
			const beats = options.beatsPerBar()
			const startBeat = (Math.floor(currentBeat / beats) + 1) * beats
			capture = {
				chainId,
				status: captureStatus,
				owner,
				startBeat,
				endBeat: startBeat + beats,
				commands: [],
				resolve,
				reject
			}
			captureStatus.textContent =
				"Waiting for the next bar; play this chain during the following bar"
		})
	manager.addEventListener(
		INPUT_EVENT,
		(event) => {
			const detail = (event as CustomEvent).detail
			if (
				!capture ||
				capture.start === undefined ||
				detail.chainId !== capture.chainId ||
				!supportsClipCommand(detail.command)
			) {
				return
			}
			if (capture.commands.length >= 20000) {
				capture.reject(new Error("Captured bar exceeds the event limit"))
				capture = undefined
				return
			}
			const command = clipCommand(
				detail.command,
				Math.max(0, options.getNow() - capture.start)
			)
			if (command.channel < 1 || command.channel > 16) {
				command.channel = 1
			}
			capture.commands.push(command)
		},
		{ signal: abort.signal }
	)
	const bindings = new Map<object, () => void>()
	const bindNodes = () => {
		const present = new Set<object>(
			manager.chains.flatMap((chain) => [...chain.inputs, ...chain.transformers])
		)
		for (const [node, release] of bindings) {
			if (!present.has(node)) {
				release()
				bindings.delete(node)
			}
		}
		for (const [, chain] of manager.entries) {
			for (const transformer of chain.transformers) {
				if (!(transformer instanceof TransformerChordTrack) || bindings.has(transformer)) {
					continue
				}
				transformer.mountProgression = (host, message) =>
					mountChordEditor(host, manager, message)
				bindings.set(transformer, () => {
					transformer.destroyGui()
					transformer.mountProgression = undefined
				})
			}
			for (const input of chain.inputs) {
				if (bindings.has(input)) {
					continue
				}
				if (input instanceof InputEventLoop) {
					input.mountTools = (host, message) =>
						mountGrooveTools(
							host,
							manager,
							options.getBpm,
							getClip,
							() =>
								captureBar(
									manager.entries.find(([, owner]) =>
										owner.inputs.includes(input)
									)?.[0] ?? "",
									message,
									input
								),
							message,
							input
						)
					bindings.set(input, () => {
						void input.destroyGui()
						input.mountTools = undefined
					})
				} else if (input instanceof InputScaleExplorer) {
					input.mountRoutes = (host, audition, message) =>
						mountRouteFinder(host, manager, audition, message, input)
					bindings.set(input, () => {
						input.mountRoutes = undefined
					})
				}
			}
		}
		if (capture && (!manager.getChain(capture.chainId) || !present.has(capture.owner))) {
			capture.reject(new Error("Capture cancelled because its input or chain was removed"))
			capture = undefined
		}
	}
	manager.addEventListener(EVENT_CHAINS_UPDATED, bindNodes, { signal: abort.signal })
	bindNodes()
	const acousticHost =
		group(document.getElementById("clock-controls"), "Follow microphone tempo") ??
		element("div")
	const acousticStatus = element("p")
	acousticStatus.setAttribute("role", "status")
	const follower = new AcousticTempoFollower(
		context,
		options.getBpm,
		(bpm) => options.setTempo(bpm),
		(message) => {
			acousticStatus.textContent = message
		},
		options.canFollow
	)
	const sensitivity = numberField(acousticHost, "Microphone sensitivity", 2.5, 1.2, 8, 0.1)
	onChange(sensitivity, () => {
		if (sensitivity.checkValidity()) {
			follower.threshold = sensitivity.valueAsNumber
		}
	})
	acousticHost.append(
		action("Start acoustic following", () => follower.start(), acousticStatus),
		action(
			"Stop acoustic following",
			() => {
				follower.stop()
				acousticStatus.textContent = "Stopped; keeping the last tempo"
			},
			acousticStatus
		),
		acousticStatus,
		element(
			"p",
			"Use Internal clock. Establish the pulse with the existing tap control, then play clear claps or percussion. The follower adjusts tempo gradually and holds it during silence. Use headphones to avoid following the app’s own sound."
		)
	)
	const projectHost =
		group(document.getElementById("export-dialog"), "Portable project") ?? element("div")
	const projectStatus = element("p")
	projectStatus.setAttribute("role", "status")
	projectHost.append(projectStatus)
	const projects = mountProjectTools(
		projectHost,
		{ ...options, getClip, setTempo: (bpm, swing) => options.setTempo(bpm, swing) },
		projectStatus
	)
	performance?.refresh()
	document
		.getElementById("btn-midi")
		?.addEventListener(EVENT_CLICK, () => performance?.refresh(), { signal: abort.signal })
	document.getElementById("settings-dialog")?.addEventListener(
		EVENT_CLOSE,
		() => {
			diagnostics?.stop()
		},
		{ signal: abort.signal }
	)
	document.getElementById("midi-dialog")?.addEventListener(
		EVENT_CLOSE,
		() => {
			options.midi.learning = null
		},
		{ signal: abort.signal }
	)
	document.getElementById("clock-source")?.addEventListener(
		EVENT_CHANGE,
		() => {
			if (!options.canFollow()) {
				follower.stop()
			}
		},
		{ signal: abort.signal }
	)
	manager.addEventListener(
		EVENT_WORKSPACE_RESTORED,
		() => {
			if (capture) {
				capture.reject(new Error("Capture cancelled because the workspace changed"))
				capture = undefined
			}
			follower.stop()
			performance?.refresh()
			bindNodes()
		},
		{ signal: abort.signal }
	)
	document.addEventListener(
		EVENT_VISIBILITY_CHANGE,
		() => {
			if (!document.hidden) {
				return
			}
			follower.stop()
			if (capture) {
				capture.reject(new Error("Capture cancelled while the app is hidden"))
				capture = undefined
			}
		},
		{ signal: abort.signal }
	)
	manager.addEventListener(
		EVENT_TRANSPORT_CHANGED,
		() => {
			if (!manager.transportRunning) {
				if (capture) {
					capture.reject(new Error("Capture cancelled because transport stopped"))
					capture = undefined
				}
			}
		},
		{ signal: abort.signal }
	)
	const destroy = () => {
		abort.abort()
		diagnostics?.stop()
		performance?.destroy()
		projects.destroy()
		follower.stop()
		if (capture) {
			capture.reject(new Error("Session closed"))
		}
		capture = undefined
		mounts.forEach((mount) => mount.remove())
		bindings.forEach((release) => release())
		bindings.clear()
	}
	window.addEventListener(EVENT_PAGE_HIDE, destroy, { once: true, signal: abort.signal })
	return {
		tick(beat: number) {
			currentBeat = beat
			manager.updateMusicalBeat(beat)
			if (capture) {
				if (beat < capture.startBeat && capture.start !== undefined) {
					capture.reject(new Error("Capture cancelled after a transport seek"))
					capture = undefined
					return
				}
				if (beat >= capture.startBeat && capture.start === undefined) {
					capture.start = options.getNow()
					capture.status.textContent = "Capturing this bar…"
				}
				if (beat >= capture.endBeat) {
					const done = capture
					capture = undefined
					try {
						done.resolve(
							finishClip(
								done.commands,
								Math.max(0.01, options.getNow() - done.start!)
							)
						)
					} catch (error) {
						done.reject(error as Error)
					}
				}
			}
		},
		destroy
	}
}