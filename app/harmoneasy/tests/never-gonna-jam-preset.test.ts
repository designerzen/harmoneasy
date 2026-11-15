import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import { parsePresetPage } from "../source/services/preset-page"
import { PUBLISHED_PRESETS } from "../source/services/preset-files"
import { INPUT_DEFINITIONS } from "audiobus/io/input-definitions"
import { OUTPUT_DEFINITIONS } from "audiobus/io/output-definitions"
import InputMIDIFile from "audiobus/io/inputs/input-midi-file"
import { INPUT_EVENT, NOTE_ON } from "audiobus/commands/commands"

const page = parsePresetPage(
	await readFile("presets/songs/never-gonna-jam-everything.json", "utf8")
)
const devices = page.workspace.devices

describe("Never Gonna Give You Up jam preset", () => {
	it("is published as a song with a play-along chain in A♭ major", () => {
		const entry = PUBLISHED_PRESETS.find(
			(item) => item.route === "presets/songs/never-gonna-jam-everything"
		)
		expect(entry?.preset.category).toBe("Songs")
		expect(page.workspace.activeChainId).toBe("play-along")
		const harmoniser = JSON.parse(JSON.parse(page.workspace.chains[0].transformers)[0])
		expect(harmoniser).toMatchObject({ type: "Harmoniser", root: 8 })
	})

	it("uses only registered inputs and outputs, including WebCLAP and the protocol input", () => {
		for (const device of devices) {
			const { factory, type } = device.definition
			if (factory === "input") {
				expect(Object.hasOwn(INPUT_DEFINITIONS, type!), type).toBe(true)
			} else if (factory === "output") {
				expect(Object.hasOwn(OUTPUT_DEFINITIONS, type!), type).toBe(true)
			} else {
				expect(["keyboard-input", "external"]).toContain(factory)
			}
		}
		const types = devices.map((device) => device.definition.type)
		expect(types).toEqual(
			expect.arrayContaining([
				"keyboard",
				"webmidi",
				"gamepad-music",
				"music-mouse",
				"protocol",
				"midi-file",
				"webclap:com.plinken.piano",
				"webclap:com.plinken.organ"
			])
		)
		// Every device is routed into a chain.
		const routed = new Set(
			page.workspace.chains.flatMap((chain) => [...chain.inputs, ...chain.outputs])
		)
		expect(devices.every((device) => routed.has(device.id))).toBe(true)
	})

	it("plays the embedded melody and bass from the MIDI file input on transport start", () => {
		const options = devices.find((device) => device.id === "song-file")!.definition.options!
		const input = new InputMIDIFile(options)
		const played: any[] = []
		input.addEventListener(INPUT_EVENT, (event) => played.push((event as CustomEvent).detail))
		input.startClock()
		input.updateTime(0)
		input.updateTime(300)
		expect(played).toHaveLength(options.commands.length)
		expect(played[0].type).toBe(NOTE_ON)
		expect(new Set(played.map((command) => command.channel))).toEqual(new Set([2, 4]))
		input.destroy()
	})
})