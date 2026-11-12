import { describe, expect, it, vi } from "vitest"
import { readPresetFiles } from "../scripts/preset-files.js"
import { loadPresetPage } from "../source/services/preset-page"

const pages = readPresetFiles("presets")
const template = pages.get("presets/songs/never-gonna-give-you-up")!
const player = (page: any) => JSON.parse(JSON.parse(page.workspace.chains[0].transformers)[0])

describe("composable MIDI and output links", () => {
	it.each(["ensemble-any-song", "ensemble-any-song-gamepads"])(
		"loads different songs through the same dynamic preset URL: %s",
		async (preset) => {
			const source = pages.get(`presets/activities/${preset}`)!
			const fetcher = vi.fn(async () => Response.json(source))
			for (const song of ["never-gonna-give-you-up.mid", "ode-to-joy.mid"]) {
				const page = await loadPresetPage(
					`https://example.test/harmoneasy/presets/activities/${preset}/?midi=midi/${song}`,
					"/harmoneasy/",
					fetcher
				)
				expect(player(page)).toMatchObject({
					type: "Ensemble",
					midiFileUrl: `https://example.test/harmoneasy/midi/${song}`,
					autoInputs: preset.endsWith("gamepads") ? "gamepads" : "keyboard",
					players: []
				})
				expect(player(page)).not.toHaveProperty("trackIndex")
				expect(page!.name).toContain("Play channels together")
				expect(page!.description).toContain("Each playable channel")
				expect(page!.workspace.chains[0].inputs).toEqual([])
			}
			expect(fetcher.mock.calls.map(([url]) => url)).toEqual(
				Array(2).fill(
					`https://example.test/harmoneasy/presets/activities/${preset}/preset.json`
				)
			)
			expect(player(source).midiFileUrl).toBe("")
		}
	)
	it.each(["?outputs=speech-synthesis", "#outputs=speech-synthesis"])(
		"adds speech to any song preset through %s without changing its MIDI or instrument",
		async (options) => {
			const page = await loadPresetPage(
				`https://example.test/app/presets/songs/never-gonna-give-you-up/${options}`,
				"/app/",
				async () => Response.json(template)
			)
			expect(player(page)).toEqual(player(template))
			expect(page!.workspace.chains[0].outputs).toEqual([
				"melody-synth",
				"url-output-speech-synthesis"
			])
			expect(page!.workspace.devices.at(-1).definition).toEqual({
				factory: "output",
				type: "speech-synthesis"
			})
			expect(
				template.workspace.devices.some(
					(device: any) => device.id === "url-output-speech-synthesis"
				)
			).toBe(false)
		}
	)

	it.each(["?", "#"])(
		"loads any direct MIDI URL at the application root using %s",
		async (separator) => {
			const midi = "https://files.example/song.mid?download=1&version=2"
			const fetcher = vi.fn(async () => Response.json(template))
			const page = await loadPresetPage(
				`https://example.test/app/${separator}midi=${encodeURIComponent(midi)}&outputs=speech-synthesis,describe`,
				"/app/",
				fetcher
			)
			expect(fetcher).toHaveBeenCalledExactlyOnceWith(
				"https://example.test/app/presets/songs/twinkle-twinkle-little-star/preset.json"
			)
			expect(player(page)).toMatchObject({
				midiFileUrl: midi,
				trackIndex: -1,
				playbackMode: "step",
				loop: true,
				searchQuery: "",
				midiFileName: ""
			})
			expect(page!.workspace.chains[0].outputs).toEqual([
				"melody-synth",
				"url-output-speech-synthesis",
				"url-output-describe"
			])
			expect(page!.name).toBe("song.mid — One-key melody")
			expect(page!.catalogue).toBeUndefined()
		}
	)

	it("prefers fragments, resolves library files below the deployment base and deduplicates outputs", async () => {
		const page = await loadPresetPage(
			"https://example.test/app/?midi=wrong.mid&outputs=describe#midi=midi/ode-to-joy.mid&outputs=speech-synthesis&outputs=speech-synthesis",
			"/app/",
			async () => Response.json(template)
		)
		expect(player(page).midiFileUrl).toBe("https://example.test/app/midi/ode-to-joy.mid")
		expect(page!.workspace.chains[0].outputs).toEqual([
			"melody-synth",
			"url-output-speech-synthesis"
		])
	})

	it("reuses existing outputs and enables them in every chain", async () => {
		const source = pages.get("presets/activities/describe-readout")!
		const speech = source.workspace.devices.find(
			(device: any) => device.definition.type === "speech-synthesis"
		)
		const disabled = structuredClone(source)
		disabled.workspace.chains[0].disabledOutputs = [speech.id]
		const page = await loadPresetPage(
			"https://example.test/app/presets/activities/describe-readout/#outputs=speech-synthesis",
			"/app/",
			async () => Response.json(disabled)
		)
		expect(page!.workspace.devices).toHaveLength(source.workspace.devices.length)
		expect(
			page!.workspace.chains[0].outputs.filter((id: string) => id === speech.id)
		).toHaveLength(1)
		expect(page!.workspace.chains[0].disabledOutputs).toEqual([])
	})

	it("composes outputs with readable play links and static redirect query links", async () => {
		for (const path of [
			"play/bitmidi/any-song-mid/#outputs=speech-synthesis",
			"?play=bitmidi/any-song-mid&outputs=speech-synthesis"
		]) {
			const fetcher = vi.fn(async (url: string) =>
				url.includes("/api/midi/get")
					? Response.json({
							result: {
								result: {
									name: "Any song.mid",
									url: "/any-song-mid",
									downloadUrl: "/uploads/99.mid"
								}
							}
						})
					: Response.json(template)
			)
			const page = await loadPresetPage(`https://example.test/app/${path}`, "/app/", fetcher)
			expect(player(page).midiFileUrl).toBe("https://bitmidi.com/uploads/99.mid")
			expect(page!.workspace.chains[0].outputs).toContain("url-output-speech-synthesis")
		}
	})

	it.each([
		"midi=javascript:alert(1)",
		"midi=data:audio/midi;base64,abc",
		"midi=",
		"outputs=unknown-output"
	])("reports invalid options: %s", async (options) => {
		const fetcher = vi.fn()
		await expect(
			loadPresetPage(`https://example.test/app/?${options}`, "/app/", fetcher)
		).rejects.toThrow()
		expect(fetcher).not.toHaveBeenCalled()
	})
})