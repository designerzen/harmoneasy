import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import { parsePresetPage } from "../source/services/preset-page"
import { PUBLISHED_PRESETS } from "../source/services/preset-files"
import { INPUT_DEFINITIONS } from "audiobus/io/input-definitions"
import { OUTPUT_DEFINITIONS } from "audiobus/io/output-definitions"

const load = async (name: string) =>
	parsePresetPage(await readFile(`presets/protocol/${name}.json`, "utf8"))
const step = await load("step-song")
const playground = await load("remote-playground")
const steps = (chain: { transformers: string }) =>
	(JSON.parse(chain.transformers) as string[]).map((item) => JSON.parse(item))

describe("audioBus Protocol demo presets", () => {
	it("are published under their own category", () => {
		for (const route of ["presets/protocol/step-song", "presets/protocol/remote-playground"]) {
			expect(PUBLISHED_PRESETS.find((entry) => entry.route === route)?.preset.category).toBe(
				"audioBus Protocol"
			)
		}
	})

	it("use only registered devices, all routed, with a listening input and an echoing output", () => {
		for (const page of [step, playground]) {
			const devices = page.workspace.devices
			for (const { definition } of devices) {
				if (definition.factory === "input") {
					expect(Object.hasOwn(INPUT_DEFINITIONS, definition.type), definition.type).toBe(true)
				} else if (definition.factory === "output") {
					expect(Object.hasOwn(OUTPUT_DEFINITIONS, definition.type), definition.type).toBe(
						true
					)
				}
			}
			const routed = new Set(
				page.workspace.chains.flatMap((chain: any) => [...chain.inputs, ...chain.outputs])
			)
			expect(devices.every((device: any) => routed.has(device.id))).toBe(true)
			expect(
				devices.some(
					(device: any) =>
						device.direction === "input" &&
						device.definition.type === "protocol" &&
						device.definition.options.acceptUnpaired === true
				)
			).toBe(true)
			expect(
				devices.find(
					(device: any) =>
						device.direction === "output" && device.definition.type === "protocol"
				)?.definition.options.sendToConnectedApplications
			).toBe(true)
		}
	})

	it("wire every key, the surface pad and remote notes to a stepping MIDI File Player", () => {
		const chain = step.workspace.chains[0]
		expect(steps(chain)).toEqual([
			expect.objectContaining({
				type: "MIDI-File-Player",
				playbackMode: "step",
				loop: true,
				midiFileUrl: "midi/never-gonna-give-you-up.mid"
			})
		])
		const keys = step.workspace.devices.find((device: any) => device.id === "playing-keys")
		const bound = keys.definition.options.bindings.map((binding: any) => binding.key)
		expect(bound).toEqual(expect.arrayContaining(["a", "z", "0", " ", "Enter", "ArrowUp"]))
		expect(chain.inputs).toEqual(
			expect.arrayContaining(["playing-keys", "next-note-pad", "remote-application"])
		)
		const surface = chain.options.controlSurfaces[0]
		expect(surface.widgets[0]).toEqual({
			key: JSON.stringify(["next-note-pad", "trigger"]),
			widget: "pad"
		})
	})

	it("splits drums from the transformed lead so remote controls have something to change", () => {
		const [lead, drums] = playground.workspace.chains
		expect(steps(lead).map((item) => [item.type, item.enabled])).toEqual([
			["Harmoniser", true],
			["Chordifier", false]
		])
		const outputs = Object.fromEntries(
			playground.workspace.devices.map((device: any) => [device.id, device.definition])
		)
		expect(outputs["lead-synth"].options.receiveChannels).not.toContain(10)
		expect(outputs["remote-drums"].options.receiveChannels).toEqual([10])
		expect(drums.outputs).toEqual(["remote-drums"])
	})
})
