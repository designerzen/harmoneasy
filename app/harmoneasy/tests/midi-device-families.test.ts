import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
	MIDI_DEVICE_PROFILES,
	matchMidiDeviceProfile
} from "audiobus/hardware/midi-devices/device-profiles"
import { midiDeviceDirectory } from "audiobus/hardware/midi-devices/device-files.js"

const volcas = ["bass", "beats", "keys", "kick", "nubass", "fm", "fm2", "sample", "sample2", "drum"]
const boutiques = [
	"a-01",
	"jp-08",
	"ju-06",
	"jx-03",
	"vp-03",
	"tb-03",
	"tr-09",
	"se-02",
	"sh-01a",
	"d-05",
	"tr-08",
	"ju-06a",
	"tr-06",
	"jd-08",
	"jx-08",
	"jupiter-08",
	"n-vision"
]
const ids = [
	...volcas.map((model) => `korg-volca-${model}`),
	...boutiques.map((model) => `roland-${model}`)
]
const controls = (id: string) => MIDI_DEVICE_PROFILES[id].controls
const notes = (id: string) =>
	MIDI_DEVICE_PROFILES[id].surface!.elements.filter((element) => element.message?.type === "note")

describe("Volca and Roland Boutique families", () => {
	it.each(ids)("registers %s with documentation, artwork and an unambiguous identity", (id) => {
		const profile = MIDI_DEVICE_PROFILES[id]
		expect(profile).toBeDefined()
		expect(profile.documentation.length).toBeGreaterThan(0)
		for (const asset of ["icon.svg", "panel.svg", `${id}.json`]) {
			expect(existsSync(path.join(midiDeviceDirectory(id), asset))).toBe(true)
		}
		expect(matchMidiDeviceProfile({ id })).toBe(id)
		for (const name of profile.portNames) {
			expect(matchMidiDeviceProfile({ name: ` ${name.toUpperCase()} ` })).toBe(id)
		}
	})

	it("keeps different generations and unrelated hardware separate", () => {
		for (const [name, id] of [
			["volca fm", "korg-volca-fm"],
			["volca fm2", "korg-volca-fm2"],
			["volca sample", "korg-volca-sample"],
			["volca sample2", "korg-volca-sample2"],
			["TB-03", "roland-tb-03"],
			["TB-3", "roland-tb-3"],
			["JU-06", "roland-ju-06"],
			["JU-06A", "roland-ju-06a"],
			["JP-08", "roland-jp-08"],
			["JUPITER-08", "roland-jupiter-08"],
			["n/vision", "roland-n-vision"]
		]) {
			expect(matchMidiDeviceProfile({ name })).toBe(id)
		}
		for (const name of [
			"volca mix",
			"volca modular",
			"K-25m",
			"DK-01",
			"TR-8",
			"TB-303",
			"JU-06A DAW"
		]) {
			expect(matchMidiDeviceProfile({ name })).toBeUndefined()
		}
	})

	it("uses each synth's documented cutoff mapping instead of a generic CC74", () => {
		for (const [id, expected] of [
			["korg-volca-keys", 44],
			["korg-volca-nubass", 43],
			["roland-ju-06", 74],
			["roland-jp-08", 74],
			["roland-sh-01a", 74],
			["roland-jd-08", 3],
			["roland-jx-08", 3],
			["roland-jupiter-08", 3],
			["roland-n-vision", 3]
		] as const) {
			expect(
				controls(id).find(
					(control) => /cutoff/i.test(control.label) && !/HPF/.test(control.label)
				)?.cc
			).toBe(expected)
		}
		expect(
			controls("korg-volca-bass").some((control) =>
				/cutoff|peak|resonance/i.test(control.label)
			)
		).toBe(false)
		expect(MIDI_DEVICE_PROFILES["korg-volca-bass"].notice).toContain("no MIDI CC")
		expect(
			controls("roland-tb-03").some((control) => control.message?.type === "pitchBend")
		).toBe(false)
	})

	it("preserves the factory multi-channel percussion assignments", () => {
		for (const id of ["korg-volca-sample", "korg-volca-sample2", "korg-volca-drum"]) {
			const surfaceNotes = notes(id)
			expect(surfaceNotes.map((element) => element.message?.channel)).toEqual(
				Array.from({ length: id.endsWith("drum") ? 6 : 10 }, (_, index) => index + 1)
			)
			expect(surfaceNotes.every((element) => element.message?.number === 60)).toBe(true)
		}
		expect(
			notes("roland-tr-06").find((element) => element.label === "Low tom")?.message
		).toEqual({ type: "note", number: 47, channel: 10 })
		expect(
			notes("roland-tr-09").find((element) => element.label === "Low tom")?.message
		).toEqual({ type: "note", number: 43, channel: 10 })
	})
})