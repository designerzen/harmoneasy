import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { loadPresetPage } from "../source/services/preset-page"
import { configurationSteps } from "audiobus/io/preset-library"
import { tranformerFactory } from "audiobus/io/transformer-factory"

const guide = readFileSync("../../docs/preset-url-api.md", "utf8")
const section = guide.split("## Cosmo MIDI session links")[1].split("## Routes and encoding")[0]
const links = [...section.matchAll(/\]\((https:\/\/harmoneasy\.pages\.dev\/[^)]+)\)/g)].map(
	(match) => match[1]
)

describe("documented Cosmo MIDI session links", () => {
	it("includes the three original song outputs and five live variations", () => {
		expect(links).toHaveLength(8)
	})
	it.each(links)("restores the setup from %s", async (link) => {
		const fetcher = vi.fn()
		const page = await loadPresetPage(link, "/", fetcher)
		expect(fetcher).not.toHaveBeenCalled()
		expect(page).toBeDefined()
		const chain = page!.workspace.chains[0]
		const input = page!.workspace.devices.find((device) => device.id === chain.inputs[0])!
		expect(input.definition).toMatchObject({ type: "cosmo-dots", options: { dotCount: 9 } })
		const steps = configurationSteps(chain.transformers)
		expect(steps.some((step) => step.type === "Harmoniser")).toBe(false)
		const url = new URL(link)
		const outputTypes = chain.outputs.map(
			(id) => page!.workspace.devices.find((device) => device.id === id)!.definition.type
		)
		if (url.pathname.includes("/transformers/")) {
			expect(outputTypes).toEqual(["moog", "webmidi"])
			expect(steps.map((step) => step.type)).toEqual(
				url.pathname.split("/transformers/")[1].split("/")[0].split(",")
			)
			expect(steps.some((step) => step.type === "MIDI-File-Player")).toBe(false)
			for (const step of steps) {
				const effect = tranformerFactory(step.type, step.config)
				try {
					expect(effect.options.enabled).toBeTruthy()
					if (step.type === "Chord-Bloom") {
						expect(effect.options).toMatchObject({ step: 0.25 })
					}
				} finally {
					effect.destroy()
				}
			}
		} else {
			expect(steps).toEqual([
				expect.objectContaining({
					type: "MIDI-File-Player",
					config: expect.objectContaining({
						playbackMode: "step",
						midiFileUrl: "https://harmoneasy.pages.dev/midi/never-gonna-give-you-up.mid"
					})
				})
			])
			expect(outputTypes).toEqual(url.pathname.split("/outputs/")[1].split("/")[0].split(","))
		}
	})
})