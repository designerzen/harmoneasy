import { afterEach, describe, expect, it, vi } from "vitest"
import { loadPresetPage } from "../source/services/preset-page"
import { playRoute, playUrl } from "../source/services/play-page"
import { readPresetFiles } from "../scripts/preset-files.js"

const template = readPresetFiles("presets").get("presets/songs/twinkle-twinkle-little-star")
afterEach(() => vi.unstubAllGlobals())

const playerConfig = (page: any) => JSON.parse(JSON.parse(page.workspace.chains[0].transformers)[0])

describe("play links", () => {
	it("reads /play/{artist}/{title} and the static redirect form below the deployment base", () => {
		const song = { artist: "rick astley", title: "never gonna give you up" }
		expect(
			playRoute(
				"https://example.test/harmoneasy/play/rick-astley/never-gonna-give-you-up/",
				"/harmoneasy/"
			)
		).toEqual(song)
		expect(
			playRoute(
				"https://example.test/harmoneasy/play/?play=rick%20astley%2Fnever_gonna+give-you-up%2F",
				"/harmoneasy/"
			)
		).toEqual(song)
		expect(playUrl(song, "/harmoneasy/", "https://example.test").href).toBe(
			"https://example.test/harmoneasy/play/rick-astley/never-gonna-give-you-up/"
		)
		expect(playRoute("https://example.test/harmoneasy/player/a/b", "/harmoneasy/")).toBe(
			undefined
		)
		expect(playRoute("https://example.test/play/the-beatles/", "/")).toEqual({
			artist: "the beatles",
			title: ""
		})
		expect(
			playUrl({ artist: "the beatles", title: "" }, "/", "https://example.test").href
		).toBe("https://example.test/play/the-beatles/")
		for (const path of ["play/", "play/a/b/c", "play/%20/title", "play/artist/%20"]) {
			expect(() => playRoute(`https://example.test/${path}`, "/")).toThrow(
				"/play/{artist}/{title}"
			)
		}
	})

	it("searches BitMidi for the artist and title and plays the best match", async () => {
		const search = vi.fn(async (input: string) => {
			expect(new URL(input).searchParams.get("q")).toBe("the beatles yesterday")
			return Response.json({
				result: {
					results: [
						{
							name: "beatles-yesterday.mid",
							url: "/beatles-yesterday-mid",
							downloadUrl: "/uploads/1.mid"
						},
						{ name: "other.mid", url: "/other-mid", downloadUrl: "/uploads/2.mid" }
					],
					total: 2,
					pageTotal: 1
				}
			})
		})
		vi.stubGlobal("fetch", search)
		const fetcher = vi.fn(async () => Response.json(template))
		const page = await loadPresetPage(
			"https://example.test/play/the-beatles/yesterday",
			"/",
			fetcher
		)
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(
			"https://example.test/presets/songs/twinkle-twinkle-little-star/preset.json"
		)
		expect(page?.name).toBe("yesterday by the beatles — One-key melody")
		expect(playerConfig(page)).toMatchObject({
			midiFileUrl: "https://bitmidi.com/uploads/1.mid",
			midiFileName: "beatles-yesterday.mid",
			searchQuery: "the beatles yesterday",
			playbackMode: "step",
			trackIndex: -1
		})
	})

	it("still opens with the search shown when BitMidi is unreachable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("down", { status: 503 }))
		)
		const page = await loadPresetPage("https://example.test/play/abba/sos", "/", async () =>
			Response.json(template)
		)
		expect(playerConfig(page)).toMatchObject({ midiFileUrl: "", searchQuery: "abba sos" })
	})

	it("lists an artist's songs without loading one when the title is omitted", async () => {
		const search = vi.fn()
		vi.stubGlobal("fetch", search)
		const page = await loadPresetPage("https://example.test/play/abba", "/", async () =>
			Response.json(template)
		)
		expect(search).not.toHaveBeenCalled()
		expect(page?.name).toBe("Songs by abba — One-key melody")
		expect(playerConfig(page)).toMatchObject({ midiFileUrl: "", searchQuery: "abba" })
	})
})