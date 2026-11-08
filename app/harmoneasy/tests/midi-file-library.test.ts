// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { pathToFileURL, URL as NodeURL } from "node:url"
import {
	TransformerMIDIFilePlayer,
	searchBitMidi
} from "audiobus/io/transformers/transformer-midi-file-player"
import AudioCommand from "audiobus/audio-command"
import { NOTE_ON } from "audiobus/commands"
import { EVENT_CHANGE } from "audiobus/event-constants"
import { readPresetFiles } from "../scripts/preset-files.js"

const { Midi } = createRequire(resolve("../../packages/audiobus/package.json"))("@tonejs/midi")
const libraryRoot = pathToFileURL(resolve("public/midi") + "/")
const transformers: TransformerMIDIFilePlayer[] = []
const nativeFetch = globalThis.fetch
function player() {
	const transformer = new TransformerMIDIFilePlayer({ playbackMode: "step" })
	transformers.push(transformer)
	return transformer
}
const press = () =>
	Object.assign(new AudioCommand(), {
		type: NOTE_ON,
		number: 60,
		velocity: 100,
		channel: 1,
		startAt: 0
	})
afterEach(() => {
	transformers.splice(0).forEach((transformer) => transformer.destroy())
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("MIDI file library and uploads", () => {
	it("publishes a complete song URL for every local file", async () => {
		const songs = JSON.parse(await readFile(new NodeURL("index.json", libraryRoot), "utf8"))
		const pages = readPresetFiles("presets")
		for (const song of songs) {
			const page = pages.get(song.route)!
			expect(page, song.route).toBeDefined()
			const transformer = JSON.parse(JSON.parse(page.workspace.chains[0].transformers)[0])
			expect(transformer).toMatchObject({
				midiFileUrl: `midi/${song.file}`,
				playbackMode: "step",
				loop: true,
				trackIndex: song.trackIndex
			})
		}
	})
	it("ships playable songs from one source and loads their melody automatically", async () => {
		const songs = JSON.parse(await readFile(new NodeURL("index.json", libraryRoot), "utf8"))
		const files = (await import("node:fs/promises")).readdir
		expect(songs.map((song: any) => song.file).sort()).toEqual(
			(await files(libraryRoot)).filter((name) => /\.midi?$/i.test(name)).sort()
		)
		for (const song of songs) {
			expect(new URL(song.source).hostname).toBe("bitmidi.com")
			const bytes = await readFile(new NodeURL(song.file, libraryRoot))
			expect(bytes.subarray(0, 4).toString()).toBe("MThd")
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => new Response(bytes))
			)
			const transformer = player()
			await transformer.loadMIDIFile(`midi/${song.file}`)
			expect(transformer.transform([press()], {} as any)[0]?.type).toBe(NOTE_ON)
		}
	})

	it("offers the shared library and resets a previous explicit track when selecting a song", async () => {
		const songs = JSON.parse(await readFile(new NodeURL("index.json", libraryRoot), "utf8"))
		const bytes = await readFile(new NodeURL(songs[0].file, libraryRoot))
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url.endsWith("index.json") ? Response.json(songs) : new Response(bytes)
			)
		)
		const transformer = player()
		transformer.setConfig("trackIndex", 24)
		const gui = await transformer.createGui()
		expect(gui.querySelector("button")?.textContent).toBe("Upload MIDI file")
		expect(gui.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toContain(".midi")
		const select = gui.querySelector<HTMLSelectElement>(
			'select[aria-label="Local MIDI songs"]'
		)!
		expect(select.options.length).toBe(songs.length + 1)
		select.value = `midi/${songs[0].file}`
		select.dispatchEvent(new Event(EVENT_CHANGE))
		await vi.waitFor(() => expect(gui.textContent).toContain(`Loaded: ${songs[0].name}`))
		expect(gui.querySelector("a")?.getAttribute("href")).toBe(`/${songs[0].route}/`)
		expect(transformer.options.trackIndex).toBe(-1)
		expect(await transformer.createGui()).toBe(gui)
	})

	it("saves uploaded bytes so a restored transformer can play without the original file", async () => {
		vi.stubGlobal("fetch", nativeFetch)
		const midi = new Midi()
		midi.addTrack().addNote({ midi: 72, time: 0, duration: 0.5 })
		const transformer = player()
		transformer.setConfig("trackIndex", 24)
		await transformer.loadMIDIUpload(new File([midi.toArray()], "my-melody.mid"))
		expect(transformer.options.midiFileUrl).toMatch(/^data:/)
		expect(transformer.getControlValue("midiFileUrl")).toBe("")
		expect(transformer.options.midiFileName).toBe("my-melody.mid")
		expect(transformer.transform([press()], {} as any)[0].number).toBe(72)
		const restored = new TransformerMIDIFilePlayer(JSON.parse(transformer.exportConfig()))
		transformers.push(restored)
		await vi.waitFor(() =>
			expect(restored.transform([press()], {} as any).at(-1)?.number).toBe(72)
		)
	})

	it("reports failed downloads and invalid uploads, and clears an empty URL without fetching", async () => {
		const transformer = player()
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json([]))
		)
		const gui = await transformer.createGui()
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("missing", { status: 404 }))
		)
		vi.spyOn(console, "error").mockImplementation(() => {})
		await transformer.loadMIDIFile("missing.mid")
		expect(gui.querySelector('[role="status"]')?.textContent).toContain(
			"Unable to load MIDI file"
		)
		await expect(transformer.loadMIDIUpload(new File(["text"], "song.txt"))).rejects.toThrow(
			".mid"
		)
		vi.mocked(fetch).mockClear()
		await transformer.loadMIDIFile("")
		expect(fetch).not.toHaveBeenCalled()
		expect(transformer.transform([press()], {} as any)).toEqual([])
	})

	it("searches BitMidi, falls back to similar titles, and loads a chosen result into memory", async () => {
		const bytes = await readFile(new NodeURL("twinkle-twinkle-little-star.mid", libraryRoot))
		const result = (q: string, page: number, pageTotal: number) => ({
			result: {
				results: [
					{
						name: `${q} ${page}.mid`,
						url: `/${q}-${page}`,
						downloadUrl: `/uploads/${page}.mid`
					}
				],
				total: pageTotal * 15,
				pageTotal
			}
		})
		const requested: string[] = []
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string) => {
				requested.push(input)
				const url = new URL(input, "http://localhost/")
				if (url.pathname.endsWith("index.json")) {
					return Response.json([])
				}
				if (url.pathname.startsWith("/uploads/")) {
					return new Response(bytes)
				}
				const q = url.searchParams.get("q")!
				return q === "twinkel star"
					? Response.json({ result: { results: [], total: 0, pageTotal: 0 } })
					: Response.json(result(q, Number(url.searchParams.get("page")), 2))
			})
		)
		const similar = await searchBitMidi(" twinkel  star ")
		expect(requested.at(-1)).toContain("q=twin%20star")
		expect(similar.results[0]).toMatchObject({
			name: "twin star 0.mid",
			downloadUrl: "https://bitmidi.com/uploads/0.mid"
		})

		const transformer = player()
		const gui = await transformer.createGui()
		const query = gui.querySelector<HTMLInputElement>('input[aria-label="Search BitMidi"]')!
		query.value = "twinkle"
		query.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
		const results = gui.querySelector('[aria-label="BitMidi results"]')!
		await vi.waitFor(() => expect(results.children.length).toBe(1))
		const more = [...gui.querySelectorAll("button")].find(
			(button) => button.textContent === "More results"
		)!
		expect(more.hidden).toBe(false)
		more.click()
		await vi.waitFor(() => expect(results.children.length).toBe(2))
		expect(more.hidden).toBe(true)
		results.querySelector("button")!.click()
		await vi.waitFor(() => expect(gui.textContent).toContain("Loaded: twinkle 0.mid"))
		expect(transformer.options.midiFileUrl).toBe("https://bitmidi.com/uploads/0.mid")
		expect(transformer.transform([press()], {} as any)[0]?.type).toBe(NOTE_ON)
	})

	it("runs a saved BitMidi search when its controls open", async () => {
		const requested: string[] = []
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string) => {
				requested.push(input)
				return input.endsWith("index.json")
					? Response.json([])
					: Response.json({ result: { results: [], total: 0, pageTotal: 0 } })
			})
		)
		const transformer = new TransformerMIDIFilePlayer({ searchQuery: "abba sos" })
		transformers.push(transformer)
		const gui = await transformer.createGui()
		expect(gui.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe("abba sos")
		expect(transformer.description).toContain("https://bitmidi.com")
		expect(gui.querySelector('a[href="https://bitmidi.com"]')?.textContent).toBe(
			"Songs from BitMidi"
		)
		await vi.waitFor(() => expect(gui.textContent).toContain("No matching or similar"))
		expect(requested.some((url) => url.includes("q=abba%20sos"))).toBe(true)
	})
})