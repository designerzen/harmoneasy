import type IOChainManager from "audiobus/io/IO-chain-manager"
import type IOChain from "audiobus/io/IO-chain"
import type { Transformer } from "audiobus/io/transformers/abstract-transformer"
import {
	EVENT_CHANGE,
	EVENT_INPUT,
	EVENT_CONFIGURATION_CHANGED,
	EVENT_SIGNAL_ACTIVITY,
	EVENT_PROCESSOR_ACTIVITY
} from "audiobus/event-constants"
import { macroValue, type MusicToolsState } from "audiobus/io/music-tools"
import { musicalCommand } from "audiobus/io/event-clip"
import { CONTROL_CHANGE } from "audiobus/commands"
import type { MidiControls } from "./midi-controls"
import { element, action, field, numberField, selectField, onChange } from "./music-tools-dom"

export interface MacroTarget {
	id: string
	name: string
	min: number
	max: number
	apply: (value: number) => void | Promise<void>
}
export function macroTargets(manager: IOChainManager): MacroTarget[] {
	const targets: MacroTarget[] = []
	for (const id of ["volume", "tempo", "swing"]) {
		const input = document.getElementById(id) as HTMLInputElement | null
		if (input) {
			targets.push({
				id: `app:${id}`,
				name: id,
				min: Number(input.min),
				max: Number(input.max),
				apply(value) {
					if (!input.disabled) {
						input.value = String(value)
						input.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
						input.dispatchEvent(new Event(EVENT_CHANGE, { bubbles: true }))
					}
				}
			})
		}
	}
	for (const [chainId, chain] of manager.entries) {
		for (const item of chain.transformers) {
			const transformer = item as Transformer<any>
			for (const control of transformer.fields) {
				if (control.name === "enabled" || !control.values?.length) {
					continue
				}
				const values = control.values.map((value) =>
					typeof value === "object" ? value.value : value
				)
				if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
					continue
				}
				const allowed = values as number[]
				targets.push({
					id: `${chainId}:${transformer.midiControlId}:${control.name}`,
					name: `${chain.options.name} / ${transformer.name} / ${control.label ?? control.name}`,
					min: Math.min(...allowed),
					max: Math.max(...allowed),
					apply(value) {
						const nearest = allowed.reduce((a, b) =>
							Math.abs(b - value) < Math.abs(a - value) ? b : a
						)
						transformer.setConfig(control.name, nearest)
					}
				})
			}
		}
	}
	for (const { id, device, direction } of manager.devices) {
		if (direction === "output" && device.sendCommand) {
			for (const [cc, name] of [
				[1, "Modulation"],
				[11, "Expression"],
				[71, "Resonance"],
				[74, "Brightness"]
			] as const) {
				targets.push({
					id: `device:${id}:cc:${cc}`,
					name: `${device.name} / ${name} (CC ${cc}, channel 1)`,
					min: 0,
					max: 127,
					apply(value) {
						if (device.isConnected) {
							return device.sendCommand(
								musicalCommand({
									type: CONTROL_CHANGE,
									number: cc,
									value: Math.round(Math.max(0, Math.min(127, value))),
									channel: 1,
									velocity: 0,
									startAt: manager.deviceOptions.now(),
									from: "performance-macro"
								})
							)
						}
					}
				})
			}
		}
	}
	return targets
}
export function mountPerformanceControls(
	host: HTMLElement,
	manager: IOChainManager,
	midi: MidiControls,
	status: HTMLElement
) {
	let frame = 0
	const animations = new Map<
		number,
		{ start: number; from: number; to: number; duration: number; state: MusicToolsState }
	>()
	const actual = new Map<number, number>()
	const commit = (state: MusicToolsState) => manager.setMusicTools(state)
	const apply = (index: number, value: number, state: MusicToolsState) => {
		const targets = macroTargets(manager)
		for (const mapping of state.macros[index].mappings) {
			try {
				const result = targets
					.find((target) => target.id === mapping.target)
					?.apply(macroValue(mapping, value))
				if (result) {
					void result.catch((error) => (status.textContent = String(error)))
				}
			} catch (error) {
				status.textContent = String(error)
			}
		}
		actual.set(index, value)
	}
	const animate = (now: number) => {
		for (const [index, animation] of animations) {
			const amount = Math.min(1, (now - animation.start) / Math.max(1, animation.duration))
			apply(index, animation.from + (animation.to - animation.from) * amount, animation.state)
			if (amount === 1) {
				animations.delete(index)
				for (const chain of manager.chains) {
					chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
				}
			}
		}
		frame = animations.size ? requestAnimationFrame(animate) : 0
	}
	const refresh = () => {
		cancelAnimationFrame(frame)
		frame = 0
		animations.clear()
		actual.clear()
		host.replaceChildren()
		host.append(
			element(
				"p",
				"Use the four controls while playing. Expand Configure to map each one to several parameters; reversed ranges invert the movement. Arrow keys adjust a focused slider. Instrument CC response depends on the instrument; device mappings use MIDI channel 1."
			)
		)
		const state = manager.musicTools
		state.macros.forEach((macro, index) => {
			const card = element("section")
			card.className = "performance-macro"
			card.dataset.midiScope = `performance-macro-${index}`
			card.dataset.midiLabel = macro.name
			const slider = element("input")
			slider.type = "range"
			slider.min = "0"
			slider.max = "1"
			slider.step = "0.01"
			slider.value = String(macro.value)
			slider.id = `performance-macro-${index}`
			slider.dataset.midiControl = "value"
			field(card, macro.name, slider)
			const value = element("output", `${Math.round(macro.value * 100)}%`)
			card.append(value)
			slider.addEventListener(EVENT_INPUT, () => {
				const current = manager.musicTools
				const desired = Number(slider.value)
				value.textContent = `${Math.round(desired * 100)}%`
				animations.set(index, {
					from: actual.get(index) ?? current.macros[index].value,
					to: desired,
					start: performance.now(),
					duration: current.macros[index].smoothing,
					state: current
				})
				if (!frame) {
					frame = requestAnimationFrame(animate)
				}
			})
			onChange(slider, () => {
				const current = manager.musicTools
				current.macros[index].value = Number(slider.value)
				commit(current)
			})
			card.append(
				action(
					"MIDI learn",
					() => {
						midi.learning = `performance-macro-${index}:INPUT:value`
						status.textContent = `Move a MIDI control for ${macro.name}`
					},
					status
				)
			)
			const config = element("details")
			config.dataset.midiIgnore = ""
			config.append(element("summary", "Configure"))
			const name = field(config, "Name", element("input"))
			name.value = macro.name
			name.maxLength = 80
			onChange(name, () => {
				const current = manager.musicTools
				current.macros[index].name = name.value
				commit(current)
			})
			const smoothing = numberField(config, "Smoothing (ms)", macro.smoothing, 0, 2000)
			onChange(smoothing, () => {
				if (smoothing.checkValidity()) {
					const current = manager.musicTools
					current.macros[index].smoothing = smoothing.valueAsNumber
					commit(current)
				}
			})
			const targets = macroTargets(manager)
			for (const [mappingIndex, mapping] of macro.mappings.entries()) {
				const row = element("div")
				row.append(
					element(
						"p",
						targets.find((target) => target.id === mapping.target)?.name ??
							`${mapping.target} (unavailable)`
					)
				)
				const minimum = numberField(row, "From", mapping.minimum, -16384, 16384, 0.01),
					maximum = numberField(row, "To", mapping.maximum, -16384, 16384, 0.01)
				for (const input of [minimum, maximum]) {
					onChange(input, () => {
						if (minimum.checkValidity() && maximum.checkValidity()) {
							const current = manager.musicTools
							Object.assign(current.macros[index].mappings[mappingIndex], {
								minimum: minimum.valueAsNumber,
								maximum: maximum.valueAsNumber
							})
							commit(current)
						}
					})
				}
				row.append(
					action(
						"Remove mapping",
						() => {
							const current = manager.musicTools
							current.macros[index].mappings.splice(mappingIndex, 1)
							commit(current)
							refresh()
						},
						status
					)
				)
				config.append(row)
			}
			const target = selectField(
				config,
				"Parameter",
				targets.map((target) => ({ name: target.name, value: target.id }))
			)
			config.append(
				action(
					"Add mapping",
					() => {
						const selected = targets.find((item) => item.id === target.value)
						if (!selected) {
							throw new Error("Add an instrument or transformer first")
						}
						const current = manager.musicTools
						current.macros[index].mappings.push({
							target: selected.id,
							minimum: selected.min,
							maximum: selected.max
						})
						commit(current)
						refresh()
					},
					status
				)
			)
			card.append(config)
			host.append(card)
		})
		host.append(
			action(
				"Cancel MIDI learn",
				() => {
					midi.learning = null
					status.textContent = "MIDI learning cancelled"
				},
				status
			)
		)
		for (const [index, macro] of state.macros.entries()) {
			apply(index, macro.value, state)
		}
	}
	return {
		refresh,
		destroy() {
			cancelAnimationFrame(frame)
			animations.clear()
		}
	}
}

interface SignalSample {
	input: number
	transform: number
	output: number
	lastInput: number
	lastTransform: number
	lastOutput: number
	error: string
	processors: Map<string, { name: string; input: number; output: number }>
}
export function mountDiagnostics(
	host: HTMLElement,
	manager: IOChainManager,
	context: AudioContext,
	master: GainNode,
	status: HTMLElement
) {
	const readings = element("div")
	host.append(
		action(
			"Enable audio",
			async () => {
				await context.resume()
				render()
			},
			status
		),
		action(
			"Restore master volume",
			() => {
				const input = document.getElementById("volume") as HTMLInputElement | null
				if (input) {
					input.value = "50"
					input.dispatchEvent(new Event(EVENT_INPUT))
					input.dispatchEvent(new Event(EVENT_CHANGE))
				}
				render()
			},
			status
		),
		readings
	)
	const samples = new Map<IOChain, SignalSample>()
	const subscriptions = new Map<IOChain, AbortController>()
	let interval: ReturnType<typeof setInterval> | undefined
	let analyser: AnalyserNode | undefined
	const data = new Float32Array(256)
	const sync = () => {
		for (const [chain, abort] of subscriptions) {
			if (!manager.chains.includes(chain)) {
				abort.abort()
				subscriptions.delete(chain)
				samples.delete(chain)
			}
		}
		for (const chain of manager.chains) {
			if (!subscriptions.has(chain)) {
				const abort = new AbortController()
				subscriptions.set(chain, abort)
				chain.diagnosticsEnabled = true
				const sample: SignalSample = {
					input: 0,
					transform: 0,
					output: 0,
					lastInput: 0,
					lastTransform: 0,
					lastOutput: 0,
					error: "",
					processors: new Map()
				}
				samples.set(chain, sample)
				chain.addEventListener(
					EVENT_PROCESSOR_ACTIVITY,
					(event) => {
						const detail = (event as CustomEvent).detail as {
							id: string
							name: string
							input: number
							output: number
						}
						const previous = sample.processors.get(detail.id)
						sample.processors.set(detail.id, {
							name: detail.name,
							input: (previous?.input ?? 0) + detail.input,
							output: (previous?.output ?? 0) + detail.output
						})
					},
					{ signal: abort.signal }
				)
				chain.addEventListener(
					EVENT_SIGNAL_ACTIVITY,
					(event) => {
						const detail = (event as CustomEvent).detail as {
							stage: "input" | "transform" | "output" | "error"
							count: number
							detail: string
							at: number
						}
						if (detail.stage === "error") {
							sample.error = detail.detail
							return
						}
						sample[detail.stage] += detail.count
						if (detail.count) {
							sample[
								detail.stage === "input"
									? "lastInput"
									: detail.stage === "transform"
										? "lastTransform"
										: "lastOutput"
							] = detail.at
						}
					},
					{ signal: abort.signal }
				)
			}
		}
	}
	const render = () => {
		sync()
		readings.replaceChildren()
		readings.append(
			element(
				"p",
				`Audio: ${context.state}. Master volume: ${Math.round(master.gain.value * 100)}%.`
			)
		)
		if (analyser) {
			analyser.getFloatTimeDomainData(data)
			const peak = Math.max(...data.map(Math.abs))
			readings.append(
				element(
					"p",
					`Master audio peak: ${peak > 0.0001 ? (20 * Math.log10(peak)).toFixed(1) + " dBFS" : "silent"}`
				)
			)
		}
		readings.append(
			element(
				"p",
				"Counts show musical commands reaching each stage, not proof that an instrument produced sound. Delays and generators may intentionally wait; MIDI hardware sound is external."
			)
		)
		for (const chain of manager.chains) {
			const sample = samples.get(chain)!
			const card = element("section")
			card.append(element("h3", chain.options.name ?? "Chain"))
			card.append(
				element(
					"p",
					`Input ${sample.input} · transformed ${sample.transform} · output ${sample.output}`
				)
			)
			const reasons: string[] = []
			for (const processor of sample.processors.values()) {
				card.append(
					element(
						"p",
						`${processor.name}: ${processor.input} in · ${processor.output} out${processor.input && !processor.output ? " — filtering or waiting for its trigger" : ""}`
					)
				)
			}
			if (!chain.isActive) {
				reasons.push("Chain is disabled; enable it in the graph.")
			}
			if (!chain.inputs.some((input) => chain.inputManager.isEnabled(input))) {
				reasons.push("No enabled input; add or enable one in the graph.")
			}
			if (!chain.outputs.some((output) => chain.outputManager.isEnabled(output))) {
				reasons.push("No enabled output; add or enable an instrument in the graph.")
			}
			for (const device of [...chain.inputs, ...chain.outputs]) {
				if ((device as any).isUnavailable) {
					reasons.push(`${device.name}: ${(device as any).reason}`)
				} else if (device.isConnected === false) {
					reasons.push(
						`${device.name} is disconnected or not ready; open its controls in the graph.`
					)
				}
			}
			if (sample.input && sample.lastInput > sample.lastTransform + 1000) {
				reasons.push(
					"Recent input has no transformed output yet; inspect filters, timing and transformer bypass."
				)
			}
			if (sample.error) {
				reasons.push(`Transformer failed: ${sample.error}`)
			}
			card.append(
				element(
					"p",
					reasons.join(" ") ||
						"No configuration problem detected. Play a note and watch the counts."
				)
			)
			readings.append(card)
		}
	}
	return {
		start() {
			if (interval) {
				return
			}
			analyser = context.createAnalyser()
			analyser.fftSize = 256
			master.connect(analyser)
			render()
			interval = setInterval(render, 500)
		},
		stop() {
			if (interval) {
				clearInterval(interval)
			}
			interval = undefined
			if (analyser) {
				master.disconnect(analyser)
				analyser.disconnect()
			}
			analyser = undefined
			for (const [chain, abort] of subscriptions) {
				chain.diagnosticsEnabled = false
				abort.abort()
			}
			subscriptions.clear()
			samples.clear()
		}
	}
}