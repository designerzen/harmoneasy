// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { mountTimingSettings } from "../source/services/timing-settings"

afterEach(() => {
	document.body.replaceChildren()
})

function setup(canSetPPQ = true) {
	document.body.innerHTML = `<button id="btn-settings"></button><form id="settings-form"></form>`
	let timing: Record<string, unknown> = {}
	const manager = Object.assign(new EventTarget(), {
		get musicalTiming() {
			return timing
		},
		setMusicalTiming: vi.fn((value: Record<string, unknown>) => {
			timing = value
		})
	})
	let ppq = 24
	const setPPQ = vi.fn((value: number) => {
		ppq = value
	})
	const settings = mountTimingSettings({
		manager: manager as any,
		getPPQ: () => ppq,
		canSetPPQ: () => canSetPPQ,
		setPPQ
	})
	const control = (label: string) =>
		[...document.querySelectorAll("label")]
			.find((item) => item.textContent?.startsWith(label))!
			.querySelector("select,input") as HTMLSelectElement & HTMLInputElement
	const change = (target: HTMLElement) => target.dispatchEvent(new Event("change"))
	return { manager, setPPQ, settings, control, change }
}

it("offers the MIDI 2.0 resolutions and applies the one chosen", () => {
	const { control, change, setPPQ } = setup()
	const ppq = control("Ticks per quarter note")

	expect([...ppq.options].map((option) => option.value)).toEqual([
		"24",
		"48",
		"96",
		"192",
		"384",
		"480",
		"960"
	])
	ppq.value = "480"
	change(ppq)

	expect(setPPQ).toHaveBeenCalledWith(480)
})

it("keeps the resolution when this player follows the room clock", () => {
	const { control, change, setPPQ } = setup(false)
	const ppq = control("Ticks per quarter note")

	expect(ppq.disabled).toBe(true)
	ppq.value = "96"
	change(ppq)

	expect(setPPQ).not.toHaveBeenCalled()
	expect(ppq.value).toBe("24")
})

it("writes the time signature and click rate as MIDI 2.0 timing", () => {
	const { control, change, manager } = setup()
	control("Beats per bar").value = "7"
	control("Beat unit").value = "8"
	control("Metronome click every").value = "12"
	change(control("Beats per bar"))

	expect(manager.setMusicalTiming).toHaveBeenLastCalledWith(
		{
			timeSignature: { numerator: 7, denominator: 8, thirtySecondNotes: 8 },
			metronome: { clocksPerClick: 12, barAccents: [0, 0, 0], subdivisions: [0, 0] }
		},
		"settings:timing"
	)
})
