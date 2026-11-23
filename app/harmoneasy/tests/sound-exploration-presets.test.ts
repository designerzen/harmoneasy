// @vitest-environment happy-dom
import { expect, it } from "vitest"
import { PUBLISHED_PRESETS } from "../source/services/preset-files"
import { presetSetup } from "../source/components/graph/preset-catalogue"
import { createPresetTransformers } from "../../../packages/audiobus/io/transformer-presets"
import { EFFECT_REGISTRY } from "../../../packages/audiobus/effects/effect-registry"
import { IMPULSE_RESPONSE_PRESETS } from "../../../packages/audiobus/effects/impulse-response-presets"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands/commands"
import { createAudioCommand } from "../../../packages/audiobus/commands/audio-command-factory"

const explorations = PUBLISHED_PRESETS.filter((entry) =>
	entry.route.startsWith("presets/sound-explorations/")
)

it("publishes sound explorations as complete instruments with connected panels and valid effects", () => {
	expect(explorations).toHaveLength(6)
	for (const { page, preset } of explorations) {
		expect(page.catalogue?.kind).toBe("workspace")
		const setup = presetSetup(preset)
		const chain = setup.chains[0]
		expect(chain.steps.length).toBe(page.catalogue?.stepSummaries?.length)
		for (const surface of chain.options.controlSurfaces ?? []) {
			for (const id of surface.panels ?? []) {
				expect(chain.outputs).toContain(id)
			}
		}
		for (const { definition } of setup.devices) {
			if (definition.type === "impulse-response") {
				expect(
					IMPULSE_RESPONSE_PRESETS.some((p) => p.id === definition.options?.preset)
				).toBe(true)
			}
			if (!definition.type?.startsWith("effect:")) {
				continue
			}
			const effect = EFFECT_REGISTRY.find((e) => `effect:${e.id}` === definition.type)!
			expect(effect).toBeDefined()
			for (const [id, value] of Object.entries(definition.options ?? {})) {
				if (id === "mix") {
					expect(effect.mix).not.toBe(false)
					expect(value).toBeGreaterThanOrEqual(0)
					expect(value).toBeLessThanOrEqual(1)
					continue
				}
				const parameter = effect.parameters.find((p) => p.id === id)!
				expect(parameter, `${preset.name}: ${id}`).toBeDefined()
				if (parameter.choices) {
					expect(parameter.choices.map((c) => c.value)).toContain(value)
				} else {
					expect(value).toBeGreaterThanOrEqual(parameter.min ?? -Infinity)
					expect(value).toBeLessThanOrEqual(parameter.max ?? Infinity)
				}
			}
		}
	}
})

it.each(explorations)(
	"runs $preset.name through its clocked pipeline without invalid notes",
	({ preset }) => {
		const transformers = createPresetTransformers(preset)
		const process = (input: ReturnType<typeof createAudioCommand>[], now: number) => {
			const timer = { BPM: 120, bpm: 120, now, divisions: 24 } as any
			return transformers.reduce(
				(events, transformer) => [
					...transformer.transform(events, timer),
					...(transformer.tick?.(now, timer) ?? [])
				],
				input
			)
		}
		const events = [
			...process([createAudioCommand(NOTE_ON, 60, 1)], 1),
			...process([createAudioCommand(NOTE_OFF, 60, 1.5)], 1.5)
		]
		for (let tick = 1; tick <= 192; tick++) {
			events.push(...process([], 1.5 + tick / 24))
		}
		expect(events.some((event) => event.type === NOTE_ON)).toBe(true)
		expect(events.some((event) => event.type === NOTE_OFF)).toBe(true)
		for (const event of events.filter(
			(event) => event.type === NOTE_ON || event.type === NOTE_OFF
		)) {
			expect(Number.isFinite(event.number)).toBe(true)
			expect(event.number).toBeGreaterThanOrEqual(0)
			expect(event.number).toBeLessThanOrEqual(127)
		}
	}
)