import type IOChainManager from "audiobus/io/IO-chain-manager"
import type AudioEventRecorder from "audiobus/audio-event-recorder"
import AudioEvent from "audiobus/audio-event"
import {
	createProjectBundle,
	readProjectBundle,
	bundleWorkspace,
	MAX_BUNDLE_BYTES,
	portableData,
	type ProjectBundle
} from "audiobus/io/project-bundle"
import type { EventClip } from "audiobus/io/event-clip"
import { validBinding, type MidiControls } from "./midi-controls"
import type { AudioRecording } from "./audio-recording"
import { element, action, field, onChange, download } from "./music-tools-dom"
import { parsePresetPage } from "./preset-page"

export function mountProjectTools(
	host: HTMLElement,
	options: {
		manager: IOChainManager
		recorder: AudioEventRecorder
		recording: AudioRecording
		midi: MidiControls
		getClip(): EventClip
		getBpm(): number
		getSwing(): number
		getClock(): { divisions: number; bars: number }
		setTempo(bpm: number, swing: number): void
		persistMidi(value: string): void
	},
	status: HTMLElement
) {
	const { manager, recording, midi } = options
	let imported: ProjectBundle | undefined
	let attachments: { name: string; type: string; bytes: Uint8Array }[] = []
	const urls: string[] = []
	const name = field(host, "Project name", element("input"))
	name.value = "Harmoneasy project"
	name.maxLength = 120
	const includeAudio = field(host, "Include current audio take (when stopped)", element("input"))
	includeAudio.type = "checkbox"
	const attach = field(
		host,
		"Attach samples or recordings you can redistribute",
		element("input")
	)
	attach.type = "file"
	attach.multiple = true
	const files = field(host, "Open .harmoneasy project", element("input"))
	files.type = "file"
	files.accept = ".harmoneasy,.zip,application/zip"
	const review = element("div")
	onChange(attach, () => {
		void (async () => {
			const selected = [...(attach.files ?? [])]
			if (selected.reduce((sum, file) => sum + file.size, 0) > MAX_BUNDLE_BYTES) {
				throw new Error("Attachments exceed 64 MB")
			}
			attachments = await Promise.all(
				selected.map(async (file) => ({
					name: file.name,
					type: file.type,
					bytes: new Uint8Array(await file.arrayBuffer())
				}))
			)
			status.textContent = `${attachments.length} attachments ready`
		})().catch((error) => (status.textContent = String(error)))
	})
	onChange(files, () => {
		void (async () => {
			const file = files.files?.[0]
			if (!file) {
				return
			}
			if (file.size > MAX_BUNDLE_BYTES) {
				throw new Error("Project exceeds 64 MB")
			}
			imported = undefined
			review.replaceChildren()
			urls.splice(0).forEach((url) => URL.revokeObjectURL(url))
			const project = await readProjectBundle(new Uint8Array(await file.arrayBuffer()))
			if (project.manifest.midiControls.bindings.some((binding) => !validBinding(binding))) {
				throw new Error("Project contains invalid MIDI mappings")
			}
			imported = project
			review.append(
				element("h3", project.manifest.name),
				element("p", `Required devices: ${project.manifest.dependencies.join(", ")}`),
				element("p", project.manifest.exclusions.join(". "))
			)
			for (const asset of project.manifest.assets) {
				const row = element("div", asset.name)
				row.append(
					action(
						"Save asset",
						() =>
							download(project.files[asset.path] as BlobPart, asset.name, asset.type),
						status
					)
				)
				if (asset.type.startsWith("audio/")) {
					const audio = element("audio")
					audio.controls = true
					const url = URL.createObjectURL(
						new Blob([project.files[asset.path] as BlobPart], { type: asset.type })
					)
					urls.push(url)
					audio.src = url
					row.append(audio)
				}
				review.append(row)
			}
			status.textContent =
				"Project inspected. Restore when ready; this replaces the current workspace. Attached assets remain available here for playback or saving."
		})().catch((error) => (status.textContent = String(error)))
	})
	host.append(
		action(
			"Download preset JSON",
			() => {
				const preset = parsePresetPage(
					JSON.stringify({
						format: "harmoneasy-preset",
						version: 1,
						name: name.value,
						description: "",
						workspace: portableData(manager.exportWorkspaceData()),
						clock: {
							bpm: options.getBpm(),
							swing: options.getSwing(),
							...options.getClock()
						},
						midiControls: { enabled: midi.enabled, bindings: midi.bindings }
					})
				)
				download(JSON.stringify(preset, null, 2) + "\n", "preset.json", "application/json")
				status.textContent =
					"Preset exported for publishing as a preset page. Hardware ports and external assets must be available on the destination."
			},
			status
		),
		action(
			"Download project bundle",
			async () => {
				const assets = [...attachments]
				if (includeAudio.checked && recording.hasTake) {
					const wave = await recording.wave(16)
					if (wave.size > MAX_BUNDLE_BYTES) {
						throw new Error(
							"Audio take exceeds the bundle limit; export WAV separately"
						)
					}
					assets.push({
						name: "master-take.wav",
						type: "audio/wav",
						bytes: new Uint8Array(await wave.arrayBuffer())
					})
				}
				const events = options.recorder.quantity ? options.getClip() : undefined
				const data = await createProjectBundle({
					name: name.value,
					workspace: manager.exportWorkspaceData(),
					bpm: options.getBpm(),
					swing: options.getSwing(),
					midiControls: { enabled: midi.enabled, bindings: midi.bindings },
					events,
					assets
				})
				download(
					data as BlobPart,
					`${name.value.replace(/[^a-zA-Z0-9_-]/g, "_") || "project"}.harmoneasy`,
					"application/zip"
				)
				status.textContent = "Project exported; credentials and plugin binaries excluded"
			},
			status
		),
		review,
		action(
			"Restore inspected project",
			async () => {
				if (!imported) {
					throw new Error("Inspect a project file first")
				}
				const project = imported
				await manager.transport("stop")
				await manager.restoreWorkspace(bundleWorkspace(project.manifest))
				options.setTempo(project.manifest.bpm, project.manifest.swing)
				midi.enabled = project.manifest.midiControls.enabled
				midi.bindings = project.manifest.midiControls.bindings.filter(validBinding)
				midi.learning = null
				options.persistMidi(
					JSON.stringify({ enabled: midi.enabled, bindings: midi.bindings })
				)
				options.recorder.clear()
				if (project.events) {
					options.recorder.addEvents(
						project.events.commands.map(
							(command) => new AudioEvent(command, command.startAt)
						)
					)
				}
				attachments = project.manifest.assets.map((asset) => ({
					name: asset.name,
					type: asset.type,
					bytes: project.files[asset.path]
				}))
				status.textContent = manager.restoreWarnings.length
					? `Project restored with unavailable-device placeholders: ${manager.restoreWarnings.join("; ")}`
					: "Project restored. Reassign hardware ports and reload attached samples into their instruments if needed."
			},
			status
		),
		element(
			"p",
			"Bundles include workspace settings, macros, grooves, musical events, MIDI mappings and selected assets. Samples attached here are saved separately; instrument sample slots may need reconnecting. Maximum expanded size: 64 MB."
		)
	)
	return {
		destroy() {
			urls.splice(0).forEach((url) => URL.revokeObjectURL(url))
		}
	}
}