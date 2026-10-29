import { describe, expect, it } from "vitest"
import { DEVICE_SUBTYPES } from "../../../packages/audiobus/io/device-classification"
import { INPUT_DEFINITIONS } from "../../../packages/audiobus/io/input-definitions"
import { OUTPUT_DEFINITIONS } from "../../../packages/audiobus/io/output-definitions"
import { TRANSFORMER_DEFINITIONS } from "../../../packages/audiobus/io/transformer-definitions"
import { INPUT_FACTORIES } from "../../../packages/audiobus/io/input-factory"
import { OUTPUT_FACTORIES } from "../../../packages/audiobus/io/output-factory"
import { TRANSFORMERS } from "../../../packages/audiobus/io/transformer-factory"
import { getAllDeviceDefinitions } from "../../../packages/audiobus/io/definitions-index"
import {
	INSTRUMENTS,
	INSTRUMENT_TYPE_SCSYNTH_INSTRUMENT
} from "../../../packages/audiobus/instruments/instrument-types"

describe("device classifications", () => {
	it("classifies every registered device with a subtype belonging to its type", () => {
		const definitions = [
			...Object.values(INPUT_DEFINITIONS),
			...Object.values(OUTPUT_DEFINITIONS),
			...Object.values(TRANSFORMER_DEFINITIONS),
			...INSTRUMENTS.values()
		]
		for (const definition of definitions) {
			expect(DEVICE_SUBTYPES[definition.type], definition.id).toContain(definition.subtype)
		}
	})

	it("keeps input and output factories consistent with their definitions", () => {
		for (const [factories, definitions] of [
			[INPUT_FACTORIES, INPUT_DEFINITIONS],
			[OUTPUT_FACTORIES, OUTPUT_DEFINITIONS]
		] as const) {
			expect(factories.map((factory) => factory.id).sort()).toEqual(
				Object.keys(definitions).sort()
			)
			for (const factory of factories) {
				expect(factory).toMatchObject({
					type: definitions[factory.id].type,
					subtype: definitions[factory.id].subtype
				})
			}
		}
		for (const id of TRANSFORMERS) {
			expect(TRANSFORMER_DEFINITIONS[id]).toBeDefined()
		}
	})

	it("groups visualisers under visual and all instruments under engine", () => {
		expect(OUTPUT_DEFINITIONS.butterchurn).toMatchObject({
			type: "visual",
			subtype: "visualiser"
		})
		expect(OUTPUT_DEFINITIONS["spectrum-analyser"]).toMatchObject({
			type: "visual",
			subtype: "visualiser"
		})
		expect(OUTPUT_DEFINITIONS.supersonic).toMatchObject({
			type: "engine",
			subtype: "instrument"
		})
		expect(INSTRUMENTS.get(INSTRUMENT_TYPE_SCSYNTH_INSTRUMENT)).toMatchObject({
			type: "engine",
			subtype: "instrument"
		})
		for (const instrument of INSTRUMENTS.values()) {
			expect(instrument).toMatchObject({ type: "engine", subtype: "instrument" })
		}
	})

	it("preserves classifications when combining definitions", async () => {
		const definitions = await getAllDeviceDefinitions()
		expect(definitions).toHaveLength(
			Object.keys(INPUT_DEFINITIONS).length +
				Object.keys(OUTPUT_DEFINITIONS).length +
				Object.keys(TRANSFORMER_DEFINITIONS).length
		)
		expect(definitions.find((device) => device.id === "butterchurn")).toMatchObject({
			kind: "output",
			type: "visual",
			subtype: "visualiser"
		})
		expect(
			definitions
				.filter((device) => device.id === "webmidi")
				.map((device) => device.kind)
				.sort()
		).toEqual(["input", "output"])
	})
})