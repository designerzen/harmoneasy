import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { FlexMetronome, FlexTimeSignature } from "audiobus/midi/flex-data"
import {
	EVENT_CLICK,
	EVENT_MUSICAL_TIMING_CHANGED,
	EVENT_PAGE_HIDE,
	EVENT_WORKSPACE_RESTORED
} from "audiobus/events/event-constants"
import { DEFAULT_PPQ, PPQ_OPTIONS } from "netronome"
import { action, element, numberField, onChange, selectField } from "./music-tools-dom"

export interface TimingSettingsOptions {
	manager: IOChainManager
	getPPQ(): number
	/** Only the clock owner may change resolution; followers receive it from the room. */
	canSetPPQ(): boolean
	setPPQ(ppq: number): void
}

const SETTINGS_SOURCE = "settings:timing"
const DEFAULT_SIGNATURE: FlexTimeSignature = { numerator: 4, denominator: 4, thirtySecondNotes: 8 }
const DEFAULT_METRONOME: FlexMetronome = {
	clocksPerClick: 24,
	barAccents: [0, 0, 0],
	subdivisions: [0, 0]
}
const DENOMINATORS = [2, 4, 8, 16, 32, 64, 128]

const ppqName = (ppq: number) =>
	ppq === DEFAULT_PPQ ? `${ppq} PPQ — MIDI 1.0 clock` : `${ppq} PPQ`

/** MIDI 2.0 timing in Settings: tick resolution, time signature and metronome click rate. */
export function mountTimingSettings(options: TimingSettingsOptions) {
	const settings = document.getElementById("settings-form")
	if (!settings) {
		return { refresh() {}, destroy() {} }
	}
	const { manager } = options
	const abort = new AbortController()
	const fieldset = element("fieldset")
	fieldset.id = "timing-settings"
	fieldset.append(element("legend", "MIDI 2.0 timing"))
	const status = element("p")
	status.setAttribute("role", "status")

	const ppq = selectField(
		fieldset,
		"Ticks per quarter note",
		PPQ_OPTIONS.map((value) => ({ name: ppqName(value), value: String(value) }))
	)
	const beats = numberField(fieldset, "Beats per bar", 4, 1, 32)
	const unit = selectField(
		fieldset,
		"Beat unit",
		DENOMINATORS.map((value) => ({ name: `1/${value} note`, value: String(value) }))
	)
	const clocks = numberField(fieldset, "Metronome click every (MIDI clocks)", 24, 1, 255)
	fieldset.append(
		element(
			"p",
			"Higher resolution gives MIDI 2.0 clips finer timing and is shared with everyone in the room. 24 clocks is one quarter note."
		),
		action(
			"Use default timing",
			() => {
				manager.setMusicalTiming({}, SETTINGS_SOURCE)
				status.textContent = "Timing reset to 4/4 with a click on every beat"
			},
			status
		),
		status
	)

	const refresh = () => {
		const { timeSignature, metronome } = manager.musicalTiming
		ppq.value = String(options.getPPQ())
		ppq.disabled = !options.canSetPPQ()
		beats.value = String((timeSignature ?? DEFAULT_SIGNATURE).numerator)
		unit.value = String((timeSignature ?? DEFAULT_SIGNATURE).denominator)
		clocks.value = String((metronome ?? DEFAULT_METRONOME).clocksPerClick)
	}
	const applyTiming = () => {
		if (!beats.checkValidity() || !clocks.checkValidity()) {
			status.textContent = "Enter whole numbers within each field’s range"
			return
		}
		const current = manager.musicalTiming
		try {
			manager.setMusicalTiming(
				{
					timeSignature: {
						...(current.timeSignature ?? DEFAULT_SIGNATURE),
						numerator: beats.valueAsNumber,
						denominator: Number(unit.value)
					},
					metronome: {
						...(current.metronome ?? DEFAULT_METRONOME),
						clocksPerClick: clocks.valueAsNumber
					}
				},
				SETTINGS_SOURCE
			)
			status.textContent = `${beats.value}/${unit.value}, click every ${clocks.value} clocks`
		} catch (error) {
			status.textContent = error instanceof Error ? error.message : String(error)
			refresh()
		}
	}
	onChange(ppq, () => {
		if (!options.canSetPPQ()) {
			status.textContent = "Resolution follows the room or external clock"
			refresh()
			return
		}
		options.setPPQ(Number(ppq.value))
		status.textContent = `Timing resolution ${ppqName(options.getPPQ())}`
	})
	for (const control of [beats, unit, clocks]) {
		onChange(control, applyTiming)
	}
	settings.append(fieldset)
	refresh()
	document.getElementById("btn-settings")?.addEventListener(EVENT_CLICK, refresh, {
		signal: abort.signal
	})
	for (const event of [EVENT_MUSICAL_TIMING_CHANGED, EVENT_WORKSPACE_RESTORED]) {
		manager.addEventListener(event, refresh, { signal: abort.signal })
	}
	const destroy = () => {
		abort.abort()
		fieldset.remove()
	}
	window.addEventListener(EVENT_PAGE_HIDE, destroy, { once: true, signal: abort.signal })
	return { refresh, destroy }
}
