import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
	MIDI_DEVICE_PROFILES,
	matchMidiDeviceProfile
} from "audiobus/midi/hardware/device-profiles"
import { parseMidiDeviceProfile } from "audiobus/midi/hardware/device-profile-schema"
import { INPUT_FACTORIES } from "audiobus/io/input-factory"
import { MIDI_DEVICE_DIRECTORY } from "audiobus/midi/hardware/device-files.js"

const devices = [
	["akai-mpk-mini-mk3", "MPK mini 3"],
	["arturia-minilab-3", "MiniLab 3"],
	["novation-launchkey-mini-mk3", "Launchkey Mini MK3"],
	["korg-minilogue", "minilogue"],
	["roland-a-49", "A-49"],
	["roland-tb-3", "TB-3"],
	["yamaha-reface-cs", "reface CS"]
] as const

describe("documented instrument registry folders", () => {
	it.each(devices)(
		"loads %s with its own matching JSON, artwork, documentation and input factory",
		(id, name) => {
			const folder = path.join(MIDI_DEVICE_DIRECTORY, id)
			const raw = JSON.parse(readFileSync(path.join(folder, `${id}.json`), "utf8"))
			const profile = parseMidiDeviceProfile(id, raw, (asset) =>
				existsSync(path.join(folder, asset)) ? `/${id}/${asset}` : undefined
			)
			expect(profile.id).toBe(id)
			expect(profile.icon).toBe(`/${id}/icon.svg`)
			expect(profile.documentation.length).toBeGreaterThan(0)
			expect(profile.manufacturerUrl).toMatch(/^https:\/\//)
			expect(profile.productUrl).toMatch(/^https:\/\//)
			expect(MIDI_DEVICE_PROFILES[id].controls).toEqual(profile.controls)
			expect(INPUT_FACTORIES.some((factory) => factory.id === id)).toBe(true)
			expect(matchMidiDeviceProfile({ id, name: "unrelated" })).toBe(id)
			expect(matchMidiDeviceProfile({ id: "host-generated-id", name })).toBe(id)
		}
	)
	it("keeps different synth implementations distinct and does not claim unrelated generations or DAW ports", () => {
		const number = (id: string, control: string) =>
			MIDI_DEVICE_PROFILES[id].controls.find((item) => item.id === control)!.cc
		expect(number("korg-minilogue", "cutoff")).toBe(43)
		expect(number("korg-minilogue", "resonance")).toBe(44)
		expect(number("yamaha-reface-cs", "cutoff")).toBe(74)
		expect(number("yamaha-reface-cs", "resonance")).toBe(71)
		expect(number("roland-a-49", "cutoff")).toBe(74)
		expect(number("roland-tb-3", "cutoff")).toBe(74)
		expect(number("roland-tb-3", "resonance")).toBe(71)
		expect(number("roland-tb-3", "accent")).toBe(16)
		expect(number("roland-tb-3", "effect")).toBe(17)
		expect(matchMidiDeviceProfile({ id: "opaque", name: "3- TB-3" })).toBe("roland-tb-3")
		expect(
			MIDI_DEVICE_PROFILES["akai-mpk-mini-mk3"].controls.every(
				(control) => control.cc === undefined
			)
		).toBe(true)
		for (const name of [
			"minilogue xd",
			"reface DX",
			"MiniLab mkII",
			"Launchkey Mini MK4",
			"Launchkey Mini MK3 DAW",
			"TB-303",
			"TB-03",
			"TB-3 virtual copy"
		]) {
			expect(matchMidiDeviceProfile({ id: "opaque", name })).toBeUndefined()
		}
	})
})