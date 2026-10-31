import { afterEach, describe, expect, it, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { TransformerMIDIFilePlayer } from "audiobus/io/transformers/transformer-midi-file-player"
import AudioCommand from "audiobus/audio-command"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands"
import { parsePresetPage } from "../source/services/preset-page"
import { completePresets, presetSetup } from "../source/components/graph/preset-catalogue"
import { builtinPresetPages } from "../source/services/builtin-preset-pages"
import { presetDirectoryEntries } from "../scripts/preset-directory.js"

const { Midi } = createRequire(new URL("../../../packages/audiobus/package.json", import.meta.url))(
	"@tonejs/midi"
)
const bytes = await readFile("public/midi/102635.mid")
const page = parsePresetPage(
	await readFile("public/preset/songs/only-way-is-up/preset.json", "utf8")
)
const config = JSON.parse(JSON.parse(page.workspace.chains[0].transformers)[0])
afterEach(() => {
	vi.unstubAllGlobals()
	vi.unstubAllEnvs()
})

describe("The Only Way Is Up song preset", () => {
	it("uses the provided file's monophonic main melody and repeats it over multiple full passes", async () => {
		const midi = new Midi(bytes)
		const melody = midi.tracks[config.trackIndex]
		expect(melody.instrument.name).toBe("alto sax")
		expect(melody.notes).toHaveLength(333)
		vi.stubEnv("BASE_URL", "/harmoneasy/")
		const fetcher = vi.fn(async () => new Response(bytes))
		vi.stubGlobal("fetch", fetcher)
		const transformer = new TransformerMIDIFilePlayer({ ...config, midiFileUrl: "" })
		try {
			await transformer.loadMIDIFile(config.midiFileUrl)
			expect(fetcher).toHaveBeenCalledExactlyOnceWith("/harmoneasy/midi/102635.mid")
			const played: number[] = []
			for (let i = 0; i < melody.notes.length * 3; i++) {
				const trigger = Object.assign(new AudioCommand(), {
					type: NOTE_ON,
					number: i % 128,
					velocity: 90,
					channel: 1,
					from: "keys",
					startAt: i
				})
				const notes = transformer.transform([trigger], {} as any)
				expect(notes).toHaveLength(1)
				expect(notes[0]).toMatchObject({ type: NOTE_ON, startAt: i, velocity: 90 })
				played.push(notes[0].number)
				const released = transformer.transform(
					[
						Object.assign(new AudioCommand(), trigger, {
							type: NOTE_OFF,
							velocity: 0,
							startAt: i + 0.5
						})
					],
					{} as any
				)
				expect(released).toHaveLength(1)
				expect(released[0]).toMatchObject({
					type: NOTE_OFF,
					number: notes[0].number,
					startAt: i + 0.5
				})
			}
			expect(played).toEqual(
				Array.from({ length: 3 }, () => melody.notes.map((note: any) => note.midi)).flat()
			)
		} finally {
			transformer.destroy()
		}
	})
	it("is discoverable in the app and directory with an independent complete setup", () => {
		const preset = completePresets([]).find((item) => item.id === "only-way-is-up")!
		expect(preset.category).toBe("Songs")
		const setup = presetSetup(preset)
		expect(setup.clock?.bpm).toBe(128)
		expect(setup.devices[0].definition.options?.bindings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: " ", command: NOTE_ON }),
				expect.objectContaining({ key: "Enter", command: NOTE_ON }),
				expect.objectContaining({ key: "1", command: NOTE_ON })
			])
		)
		expect(setup.chains[0].steps[0].config).toMatchObject({
			playbackMode: "step",
			trackIndex: 24,
			loop: true
		})
		const pages = builtinPresetPages()
		expect(pages.get("presets/songs/only-way-is-up")).toEqual(page)
		expect(pages.get("preset/songs/only-way-is-up")).toEqual(page)
		expect(
			presetDirectoryEntries(pages).filter(
				(entry) => entry.route === "presets/songs/only-way-is-up"
			)
		).toHaveLength(1)
		setup.devices[0].definition.type = "changed"
		expect(presetSetup(preset).devices[0].definition.type).toBe("keyboard")
	})
})