// @vitest-environment happy-dom
import { expect, it } from "vitest"
import { TransformerHarmoniser } from "../../../packages/audiobus/io/transformers/transformer-harmoniser"
import { TRANSFORMER_DEFINITIONS } from "../../../packages/audiobus/io/transformer-definitions"

it("shows the chosen key and notes, updates from controls, and recreates cleanly", async () => {
	const effect = new TransformerHarmoniser()
	try {
		const gui = await effect.createGui()
		const summary = gui.querySelector('[aria-label="Selected scale"]')!
		expect(summary.textContent).toContain("C · Major (Ionian)")
		expect(summary.textContent).toContain("C · D · E · F · G · A · B")
		effect.setControlValue("root", 9)
		effect.setControlValue("mode", [0, 3, 5, 7, 10])
		expect(summary.textContent).toContain("A · Minor pentatonic")
		expect(summary.textContent).toContain("A · C · D · E · G")
		expect(await effect.createGui()).toBe(gui)
		expect(gui.querySelectorAll('[aria-label="Selected scale"]')).toHaveLength(1)
		effect.destroyGui()
		const replacement = await effect.createGui()
		expect(replacement).not.toBe(gui)
		effect.setConfig("root", 0)
		expect(replacement.textContent).toContain("C · Minor pentatonic")
	} finally {
		effect.destroy()
	}
})

it("describes scale mapping in the Tuning catalogue", () => {
	expect(TRANSFORMER_DEFINITIONS.Harmoniser).toMatchObject({
		category: "Tuning",
		subtype: "pitch"
	})
	expect(TRANSFORMER_DEFINITIONS.Harmoniser.description).toContain("key and scale")
})