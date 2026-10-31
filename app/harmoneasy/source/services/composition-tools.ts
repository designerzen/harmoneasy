import type IOChainManager from "audiobus/io/IO-chain-manager"
import {
	DEFAULT_CHORDS,
	parseProgression,
	harmonicRoutes,
	captureGroove,
	applyGroove
} from "audiobus/io/music-tools"
import { parseEventClip, type EventClip } from "audiobus/io/event-clip"
import type InputScaleExplorer from "audiobus/io/inputs/input-scale-explorer"
import type InputEventLoop from "audiobus/io/inputs/input-event-loop"
import { allPitchSetClasses, pitchClasses } from "audiobus/tuning/pitch-class-set"
import { effectiveScaleSet } from "audiobus/io/scale-explorer-controls"
import { EVENT_CHAINS_UPDATED } from "audiobus/event-constants"
import {
	element,
	action,
	field,
	numberField,
	selectField,
	onChange,
	download
} from "./music-tools-dom"

const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
const CHORD_QUALITIES = [
	{ name: "Major", value: "145" },
	{ name: "Minor", value: "137" },
	{ name: "Dominant seventh", value: "1169" },
	{ name: "Major seventh", value: "2193" },
	{ name: "Minor seventh", value: "1161" },
	{ name: "Diminished", value: "73" },
	{ name: "Suspended fourth", value: "161" },
	{ name: "Custom notes", value: "custom" }
]
const transposeMask = (mask: number, semitones: number) =>
	pitchClasses(mask).reduce((result, pitch) => result | (1 << ((pitch + semitones + 12) % 12)), 0)

export function mountChordEditor(host: HTMLElement, manager: IOChainManager, status: HTMLElement) {
	let steps = manager.musicTools.progression
	let saved = JSON.stringify(steps)
	const abort = new AbortController()
	const editor = element("div")
	editor.className = "chord-progression-editor"
	const commit = () => {
		const state = manager.musicTools
		state.progression = parseProgression(steps)
		saved = JSON.stringify(state.progression)
		manager.setMusicTools(state)
		status.textContent = "Progression applied to every Shared Chord Track transformer"
		renderRows()
	}
	const renderRows = () => {
		const expanded = [...editor.querySelectorAll<HTMLDetailsElement>(":scope > details")].map(
			(chord) => chord.open
		)
		editor.replaceChildren()
		steps.forEach((step, index) => {
			const row = element("fieldset")
			row.append(element("legend", `Chord ${index + 1}`))
			const name = field(row, "Name", element("input"))
			name.value = step.name
			name.maxLength = 80
			onChange(name, () => {
				step.name = name.value
				commit()
			})
			const root = selectField(
				row,
				"Root",
				NOTE_NAMES.map((name, value) => ({ name, value: String(value) })),
				String(step.root)
			)
			onChange(root, () => {
				const next = Number(root.value)
				step.mask = transposeMask(step.mask, next - step.root)
				step.root = next
				step.name = NOTE_NAMES[next]
				commit()
			})
			const relative = transposeMask(step.mask, -step.root)
			const quality = selectField(
				row,
				"Chord",
				CHORD_QUALITIES,
				CHORD_QUALITIES.some((item) => item.value === String(relative))
					? String(relative)
					: "custom"
			)
			onChange(quality, () => {
				if (quality.value === "custom") {
					return
				}
				step.mask = transposeMask(Number(quality.value), step.root)
				step.name = `${NOTE_NAMES[step.root]} ${quality.selectedOptions[0].textContent}`
				commit()
			})
			const beats = numberField(row, "Beats", step.beats, 0.25, 64, 0.25)
			const scale = numberField(
				row,
				"Scale pitch-set ID (absolute; C = bit 0)",
				step.scale ?? 2741,
				0,
				4095
			)
			onChange(scale, () => {
				if (scale.checkValidity()) {
					step.scale = scale.valueAsNumber
					commit()
				}
			})
			onChange(beats, () => {
				if (beats.checkValidity()) {
					step.beats = beats.valueAsNumber
					commit()
				}
			})
			const pitches = element("div")
			pitches.className = "chord-note-controls"
			pitches.setAttribute("role", "group")
			pitches.setAttribute("aria-label", `Notes in chord ${index + 1}`)
			NOTE_NAMES.forEach((note, pitch) => {
				const button = action(
					note,
					() => {
						step.mask ^= 1 << pitch
						commit()
					},
					status
				)
				button.setAttribute("aria-pressed", String(Boolean(step.mask & (1 << pitch))))
				pitches.append(button)
			})
			row.append(pitches)
			const earlier = action(
				"Move earlier",
				() => {
					;[steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]
					commit()
				},
				status
			)
			earlier.disabled = index === 0
			const remove = action(
				"Remove chord",
				() => {
					steps.splice(index, 1)
					commit()
				},
				status
			)
			remove.disabled = steps.length === 1
			row.append(earlier, remove)
			const chord = element("details")
			chord.className = "chord-step"
			chord.open = expanded[index] ?? index === 0
			chord.append(
				element("summary", `${index + 1}. ${step.name} · ${step.beats} beats`),
				row
			)
			editor.append(chord)
		})
	}
	host.append(
		element(
			"p",
			"Play this chain to hear the progression. Follow as selects melody, bass or chords. Changes apply immediately and are shared by every Shared Chord Track transformer."
		),
		editor,
		action(
			"Add chord",
			() => {
				if (steps.length >= 128) {
					throw new Error("Maximum 128 chords")
				}
				steps.push({ ...DEFAULT_CHORDS[0] })
				commit()
			},
			status
		)
	)
	const refresh = () => {
		steps = manager.musicTools.progression
		saved = JSON.stringify(steps)
		renderRows()
	}
	manager.addEventListener(
		EVENT_CHAINS_UPDATED,
		() => {
			if (JSON.stringify(manager.musicTools.progression) !== saved) {
				refresh()
			}
		},
		{ signal: abort.signal }
	)
	return { refresh, destroy: () => abort.abort() }
}

function scaleChoices(current?: number) {
	return [
		...new Set([
			...(current ? [current] : []),
			...DEFAULT_CHORDS.map((step) => step.mask),
			...allPitchSetClasses()
		])
	].map((mask) => ({
		name: pitchClasses(mask)
			.map((pitch) => NOTE_NAMES[pitch])
			.join(", "),
		value: String(mask)
	}))
}

export function mountRouteFinder(
	host: HTMLElement,
	manager: IOChainManager,
	audition: (mask: number) => Promise<void>,
	status: HTMLElement,
	explorer: InputScaleExplorer
) {
	const start = selectField(
			host,
			"Start collection",
			scaleChoices(effectiveScaleSet(explorer.options)),
			String(effectiveScaleSet(explorer.options))
		),
		destination = selectField(host, "Destination collection", scaleChoices(), "529")
	const results = element("div")
	host.append(
		action(
			"Use current collection as start",
			() => {
				const mask = effectiveScaleSet(explorer.options)
				if (![...start.options].some((option) => option.value === String(mask))) {
					const option = element(
						"option",
						pitchClasses(mask)
							.map((pitch) => NOTE_NAMES[pitch])
							.join(", ")
					)
					option.value = String(mask)
					start.append(option)
				}
				start.value = String(mask)
			},
			status
		),
		action(
			"Find musical routes",
			() => {
				const routes = harmonicRoutes(Number(start.value), Number(destination.value))
				results.replaceChildren()
				for (const [index, route] of routes.entries()) {
					const card = element("section")
					card.append(element("h3", `Route ${index + 1}`))
					for (const [step, mask] of route.masks.entries()) {
						const row = element(
							"p",
							`${pitchClasses(mask)
								.map((pitch) => NOTE_NAMES[pitch])
								.join(
									", "
								)}. ${route.explanations[step - 1] ?? "Starting collection."} `
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
									name: pitchClasses(mask)
										.map((pitch) => NOTE_NAMES[pitch])
										.join("–"),
									mask,
									root: pitchClasses(mask)[0],
									beats: 4
								}))
								manager.setMusicTools(state)
								status.textContent =
									"Route applied to Shared Chord Track transformers"
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
			"Find a path between note collections. Audition plays through this Scale Explorer’s chain. Use as chord progression applies the route to Shared Chord Track transformers."
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
	status: HTMLElement,
	loop: InputEventLoop
) {
	const outer = host
	const details = element("details")
	details.append(element("summary", "Groove transfer"))
	host = element("div")
	host.className = "context-controls"
	details.append(host)
	outer.append(details)
	const name = field(host, "Groove name", element("input"))
	name.value = "My groove"
	name.maxLength = 80
	const grid = selectField(host, "Grid", [
		{ name: "Sixteenth", value: "0.25" },
		{ name: "Eighth", value: "0.5" },
		{ name: "Quarter", value: "1" }
	])
	const templates = selectField(host, "Saved groove", [])
	const abort = new AbortController()
	let savedGrooves = ""
	const timing = numberField(host, "Timing strength (%)", 100, 0, 100),
		dynamics = numberField(host, "Accent strength (%)", 100, 0, 100)
	const refresh = () => {
		const selected = templates.value
		savedGrooves = JSON.stringify(manager.musicTools.grooves)
		templates.replaceChildren(
			...manager.musicTools.grooves.map((groove, index) => {
				const option = element("option", groove.name)
				option.value = String(index)
				return option
			})
		)
		if ([...templates.options].some((option) => option.value === selected)) {
			templates.value = selected
		}
	}
	manager.addEventListener(
		EVENT_CHAINS_UPDATED,
		() => {
			if (JSON.stringify(manager.musicTools.grooves) !== savedGrooves) {
				refresh()
			}
		},
		{ signal: abort.signal }
	)
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
			parseEventClip({
				version: 1,
				duration: loop.options.duration,
				commands: loop.options.commands
			}),
			groove,
			getBpm(),
			timing.valueAsNumber / 100,
			dynamics.valueAsNumber / 100
		)
	}

	outer.prepend(
		action(
			"Capture next bar into this loop",
			async () => {
				const clip = await capture()
				loop.load(clip)
				status.textContent = "Bar captured. Stop then Play transport to hear this loop."
			},
			status
		),
		action(
			"Load recorded events into this loop",
			() => {
				loop.load(getClip())
				status.textContent = "Recorded events loaded. Stop then Play transport."
			},
			status
		)
	)
	host.append(
		action("Capture next bar as groove", async () => save(await capture()), status),
		action(
			"Save this loop as groove",
			() =>
				save(
					parseEventClip({
						version: 1,
						duration: loop.options.duration,
						commands: loop.options.commands
					})
				),
			status
		),
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
			"Apply groove to this loop",
			() => {
				loop.load(transform())
				status.textContent = "Groove applied. Stop then Play transport to hear this loop."
			},
			status
		),
		element(
			"p",
			"Capture starts on the next bar while transport runs. Groove transfer shifts note releases with their attacks; zero strength leaves the source unchanged."
		)
	)
	return { refresh, destroy: () => abort.abort() }
}