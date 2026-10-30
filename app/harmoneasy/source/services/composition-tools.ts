import type IOChainManager from "audiobus/io/IO-chain-manager"
import type IOChain from "audiobus/io/IO-chain"
import { TransformerChordTrack } from "audiobus/io/transformers/transformer-chord-track"
import { TransformerImprovPartner } from "audiobus/io/transformers/transformer-improv-partner"
import {
	DEFAULT_CHORDS,
	parseProgression,
	harmonicRoutes,
	captureGroove,
	applyGroove
} from "audiobus/io/music-tools"
import { parseEventClip, type EventClip } from "audiobus/io/event-clip"
import InputEventLoop from "audiobus/io/inputs/input-event-loop"
import { defineDevice } from "audiobus/io/device-definition"
import { pitchClasses } from "audiobus/tuning/pitch-class-set"
import { effectiveScaleSet } from "audiobus/io/scale-explorer-controls"
import { EVENT_CONFIGURATION_CHANGED } from "audiobus/event-constants"
import {
	element,
	action,
	field,
	numberField,
	selectField,
	onChange,
	download
} from "./music-tools-dom"

export function mountChordEditor(host: HTMLElement, manager: IOChainManager, status: HTMLElement) {
	let steps = manager.musicTools.progression
	const editor = element("div"),
		followers = element("div")
	const renderRows = () => {
		editor.replaceChildren()
		steps.forEach((step, index) => {
			const row = element("fieldset")
			row.append(element("legend", `Chord ${index + 1}`))
			const name = field(row, "Name", element("input"))
			name.value = step.name
			name.maxLength = 80
			onChange(name, () => (step.name = name.value))
			const mask = numberField(row, "Pitch-set ID", step.mask, 0, 4095),
				beats = numberField(row, "Beats", step.beats, 0.25, 64, 0.25),
				root = numberField(row, "Root pitch class (C=0)", step.root, 0, 11)
			for (const control of [mask, beats, root]) {
				onChange(control, () => {
					step.mask = mask.valueAsNumber
					step.beats = beats.valueAsNumber
					step.root = root.valueAsNumber
				})
			}
			row.append(
				element("p", `Pitch classes: ${pitchClasses(step.mask).join(", ") || "silence"}`)
			)
			row.append(
				action(
					"Move earlier",
					() => {
						if (index) {
							;[steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]
						}
						renderRows()
					},
					status
				),
				action(
					"Remove chord",
					() => {
						steps.splice(index, 1)
						renderRows()
					},
					status
				)
			)
			editor.append(row)
		})
	}
	const renderFollowers = () => {
		followers.replaceChildren(element("h3", "Chains following this progression"))
		for (const chain of manager.chains) {
			const existing = chain.transformers.find(
				(item) => item instanceof TransformerChordTrack
			) as TransformerChordTrack | undefined
			const role = selectField(
				followers,
				chain.options.name ?? "Chain",
				["independent", "melody", "bass", "chords"].map((value) => ({
					name: value,
					value
				})),
				existing ? String(existing.options.role) : "independent"
			)
			onChange(role, () => {
				chain.clearNoteCommands()
				if (role.value === "independent") {
					if (existing) {
						chain.removeTransformer(existing)
					}
				} else {
					const transformer = existing ?? new TransformerChordTrack()
					transformer.setConfig("role", role.value)
					transformer.setProgression(manager.musicTools.progression)
					if (!existing) {
						chain.appendTransformer(transformer)
					}
					chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
				}
				renderFollowers()
			})
		}
	}
	host.append(
		element(
			"p",
			"Each pitch-set ID describes absolute pitch classes (C=0). Changes follow the shared transport; independent chains keep their own harmony. Root selects the bass note."
		),
		editor,
		action(
			"Add chord",
			() => {
				if (steps.length >= 128) {
					throw new Error("Maximum 128 chords")
				}
				steps.push({ ...DEFAULT_CHORDS[0] })
				renderRows()
			},
			status
		),
		action(
			"Save progression",
			() => {
				const state = manager.musicTools
				state.progression = parseProgression(steps)
				manager.setMusicTools(state)
				status.textContent = "Progression saved"
			},
			status
		),
		followers
	)
	return {
		refresh() {
			steps = manager.musicTools.progression
			renderRows()
			renderFollowers()
		}
	}
}

export function mountRouteFinder(
	host: HTMLElement,
	manager: IOChainManager,
	audition: (mask: number) => Promise<void>,
	status: HTMLElement
) {
	const start = numberField(host, "Start pitch-set ID", 145, 1, 4095),
		destination = numberField(host, "Destination pitch-set ID", 529, 1, 4095)
	const results = element("div")
	host.append(
		action(
			"Use active Scale Explorer as start",
			() => {
				const explorer = manager.activeChain?.inputs.find(
					(input) => input.name === "Scale Explorer"
				)
				if (!explorer) {
					throw new Error("Add a Scale Explorer input to the active chain first")
				}
				start.value = String(effectiveScaleSet((explorer as any).options))
			},
			status
		),
		action(
			"Find musical routes",
			() => {
				const routes = harmonicRoutes(start.valueAsNumber, destination.valueAsNumber)
				results.replaceChildren()
				for (const [index, route] of routes.entries()) {
					const card = element("section")
					card.append(element("h3", `Route ${index + 1}`))
					for (const [step, mask] of route.masks.entries()) {
						const row = element(
							"p",
							`${mask}: ${pitchClasses(mask).join(", ")}. ${route.explanations[step - 1] ?? "Starting collection."} `
						)
						row.append(action("Audition", () => audition(mask), status))
						card.append(row)
					}
					card.append(
						action(
							"Use as chord progression",
							() => {
								const state = manager.musicTools
								state.progression = route.masks.map((mask) => ({
									name: `Set ${mask}`,
									mask,
									root: pitchClasses(mask)[0],
									beats: 4
								}))
								manager.setMusicTools(state)
								status.textContent =
									"Route saved to the shared chord track; reopen its editor to review"
							},
							status
						)
					)
					results.append(card)
				}
			},
			status
		),
		element(
			"p",
			"These are short heuristic routes that retain common tones or move pitch classes. They are not a claim of globally optimal voice leading; pitch-class numbers use C=0."
		),
		results
	)
}

export function mountGrooveTools(
	host: HTMLElement,
	manager: IOChainManager,
	getBpm: () => number,
	getClip: () => EventClip,
	capture: () => Promise<EventClip>,
	status: HTMLElement
) {
	let source: EventClip | undefined
	const name = field(host, "Groove name", element("input"))
	name.value = "My groove"
	name.maxLength = 80
	const grid = selectField(host, "Grid", [
		{ name: "Sixteenth", value: "0.25" },
		{ name: "Eighth", value: "0.5" },
		{ name: "Quarter", value: "1" }
	])
	const templates = selectField(host, "Saved groove", [])
	const timing = numberField(host, "Timing strength (%)", 100, 0, 100),
		dynamics = numberField(host, "Accent strength (%)", 100, 0, 100)
	const refresh = () => {
		templates.replaceChildren(
			...manager.musicTools.grooves.map((groove, index) => {
				const option = element("option", groove.name)
				option.value = String(index)
				return option
			})
		)
	}
	const save = (clip: EventClip) => {
		const state = manager.musicTools
		if (state.grooves.length >= 32) {
			throw new Error("Remove a groove before adding another (maximum 32)")
		}
		state.grooves.push(captureGroove(clip, getBpm(), Number(grid.value), name.value))
		manager.setMusicTools(state)
		refresh()
		status.textContent = "Groove saved"
	}
	const transform = () => {
		const groove = manager.musicTools.grooves[Number(templates.value)]
		if (!groove) {
			throw new Error("Capture a groove first")
		}
		return applyGroove(
			source ?? getClip(),
			groove,
			getBpm(),
			timing.valueAsNumber / 100,
			dynamics.valueAsNumber / 100
		)
	}
	const file = field(host, "Load source event loop", element("input"))
	file.type = "file"
	file.accept = ".json,application/json"
	onChange(file, () => {
		void (async () => {
			const selected = file.files?.[0]
			if (!selected) {
				return
			}
			if (selected.size > 8 * 1024 * 1024) {
				throw new Error("Loop exceeds 8 MB")
			}
			source = parseEventClip(JSON.parse(await selected.text()))
			status.textContent = "Source loop loaded"
		})().catch((error) => (status.textContent = String(error)))
	})
	host.append(
		action("Capture next bar as groove", async () => save(await capture()), status),
		action("Use captured events as groove", () => save(getClip()), status),
		action(
			"Remove saved groove",
			() => {
				const state = manager.musicTools
				state.grooves.splice(Number(templates.value), 1)
				manager.setMusicTools(state)
				refresh()
			},
			status
		),
		action(
			"Download transformed loop",
			() => download(JSON.stringify(transform()), "grooved-loop.json", "application/json"),
			status
		),
		action(
			"Play transformed loop in active chain",
			() => {
				const chain = manager.activeChain
				if (!chain) {
					throw new Error("Choose a chain first")
				}
				const clip = transform()
				const input = defineDevice(new InputEventLoop(clip), {
					factory: "input",
					type: "event-loop",
					options: clip
				})
				manager.addDevice(chain, input, "input")
				status.textContent = "Loop added. Stop then Play transport to hear it."
			},
			status
		),
		element(
			"p",
			"Capture starts on the next bar while transport runs. Groove transfer shifts note releases with their attacks; zero strength leaves the source unchanged."
		)
	)
	return { refresh }
}

export function mountPartner(host: HTMLElement, manager: IOChainManager, status: HTMLElement) {
	const chains = selectField(host, "Chain", [])
	const mode = selectField(
		host,
		"Mode",
		["respond", "listen"].map((value) => ({ name: value, value }))
	)
	const gap = numberField(host, "Gap before reply (beats)", 2, 1, 8)
	const variation = numberField(host, "Variation (%)", 25, 0, 100)
	const silence = numberField(host, "Skip every Nth reply (0 = never)", 0, 0, 8)
	const refresh = () => {
		chains.replaceChildren(
			...manager.entries.map(([id, chain]) => {
				const option = element("option", chain.options.name)
				option.value = id
				return option
			})
		)
		if (manager.activeChainId) {
			chains.value = manager.activeChainId
		}
	}
	const partner = (chain: IOChain) =>
		chain.transformers.find((t) => t instanceof TransformerImprovPartner) as
			| TransformerImprovPartner
			| undefined
	host.append(
		action(
			"Enable / update partner",
			() => {
				const chain = manager.getChain(chains.value)
				if (!chain) {
					throw new Error("Choose a chain")
				}
				for (const control of [gap, variation, silence]) {
					if (!control.checkValidity()) {
						throw new Error("Choose values within the displayed ranges")
					}
				}
				const existing = partner(chain)
				const transformer = existing ?? new TransformerImprovPartner()
				transformer.setConfig("mode", mode.value)
				transformer.setConfig("gap", gap.valueAsNumber)
				transformer.setConfig("variation", variation.valueAsNumber)
				transformer.setConfig("silence", silence.valueAsNumber)
				if (!existing) {
					chain.appendTransformer(transformer)
				}
				chain.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
				status.textContent =
					"Partner enabled. Play a phrase on running transport, then leave a gap; play again to interrupt."
			},
			status
		),
		action(
			"Forget remembered motifs",
			() => {
				const chain = manager.getChain(chains.value)
				if (chain) {
					partner(chain)?.clearMemory()
				}
				status.textContent = "Motif memory cleared"
			},
			status
		),
		action(
			"Remove partner",
			() => {
				const chain = manager.getChain(chains.value)
				const transformer = chain && partner(chain)
				if (chain && transformer) {
					chain.clearNoteCommands()
					chain.removeTransformer(transformer)
				}
			},
			status
		),
		element(
			"p",
			"The partner remembers up to eight phrases during this session and makes deterministic variations. Its replies follow the shared chord track when this chain follows it; no model download is needed."
		)
	)
	return { refresh }
}