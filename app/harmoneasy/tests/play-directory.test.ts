// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import { EVENT_INPUT, EVENT_CHANGE } from "audiobus/event-constants"
import {
	mountPlayDirectory,
	loadPlayDirectory,
	playDirectoryCatalogue
} from "../scripts/play-directory.js"

describe("play directory", () => {
	it("loads the compact catalogue separately, retains filters, and allows retry after failure", async () => {
		const root = document.createElement("main")
		root.dataset.base = "/harmoneasy/"
		root.innerHTML = `<form><input name="q" value="Queen"><select name="artist"><option value="">All</option></select><select name="category"><option value="">All</option></select><select name="sort"><option value="artist">Artist</option></select></form><span role="status"></span><button>Clear</button><div class="tracks"><a href="/existing">Existing track</a></div><p class="empty" hidden></p><a class="more" hidden></a><button class="retry" hidden>Retry</button>`
		const data = playDirectoryCatalogue([
			{
				name: "Bohemian Rhapsody",
				artist: "Queen",
				category: "BitMidi catalogue",
				route: "play/bitmidi/queen-bohemian-rhapsody-mid"
			},
			{
				name: "Twinkle",
				artist: "Traditional",
				category: "Nursery rhyme",
				route: "presets/songs/twinkle"
			}
		])
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response("down", { status: 503 }))
			.mockResolvedValue(Response.json(data))
		await loadPlayDirectory(root, "/harmoneasy/play/catalogue-abc.json", fetcher)
		expect(root.querySelector(".tracks a")?.textContent).toBe("Existing track")
		expect(root.querySelector<HTMLButtonElement>(".retry")?.hidden).toBe(false)
		root.querySelector<HTMLButtonElement>(".retry")!.click()
		await vi.waitFor(() =>
			expect(root.querySelector("h2")?.textContent).toBe("Bohemian Rhapsody")
		)
		expect(root.querySelector("h2 a")?.getAttribute("href")).toBe(
			"/harmoneasy/play/bitmidi/queen-bohemian-rhapsody-mid/"
		)
		expect(root.querySelectorAll("article")).toHaveLength(1)
		expect(fetcher).toHaveBeenLastCalledWith("/harmoneasy/play/catalogue-abc.json", {
			cache: "force-cache"
		})
		expect(root.querySelector<HTMLButtonElement>(".retry")?.hidden).toBe(true)
	})
	it("searches all 10,000 entries while rendering only one page", () => {
		const root = document.createElement("main")
		root.dataset.base = "/harmoneasy/"
		root.innerHTML = `<form><input name="q"><select name="artist"><option value="">All</option></select><select name="category"><option value="">All</option></select><select name="sort"><option value="title">Title</option></select></form><span role="status"></span><button>Clear</button><div class="tracks"></div><p class="empty" hidden></p><a class="more" hidden></a><button class="previous">Previous</button><span class="page-number"></span><button class="next">Next</button>`
		const songs = Array.from({ length: 10000 }, (_, index) => ({
			name: `Track ${String(index).padStart(5, "0")}`,
			artist: "Not specified",
			category: "BitMidi catalogue",
			route: `play/bitmidi/track-${index}-mid`
		}))
		mountPlayDirectory(root, songs)
		expect(root.querySelectorAll("article")).toHaveLength(60)
		root.querySelector<HTMLButtonElement>(".next")!.click()
		expect(root.querySelector("h2")?.textContent).toBe("Track 00060")
		const search = root.querySelector<HTMLInputElement>("input")!
		search.value = "09999"
		search.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
		expect(root.querySelectorAll("article")).toHaveLength(1)
		expect(root.querySelector("h2 a")?.getAttribute("href")).toBe(
			"/harmoneasy/play/bitmidi/track-9999-mid/"
		)
		expect(root.querySelector(".page-number")?.textContent).toBe("Page 1 of 1")
	})
	it("combines search and filters, sorts, clears and links to a broader search", () => {
		const root = document.createElement("main")
		root.dataset.base = "/harmoneasy/"
		root.innerHTML = `<form><input name="q"><select name="artist"><option value="">All</option><option>Rick Astley</option></select><select name="category"><option value="">All</option><option>Pop</option></select><select name="sort"><option value="title">Title</option><option value="artist">Artist</option></select></form><span role="status"></span><button>Clear</button><div class="tracks"><article data-title="Twinkle" data-artist="Traditional" data-category="Nursery rhyme" data-search="twinkle traditional nursery rhyme"></article><article data-title="Never Gonna Give You Up" data-artist="Rick Astley" data-category="Pop" data-search="never gonna give you up rick astley pop"></article></div><p class="empty" hidden></p><a class="more" hidden></a>`
		mountPlayDirectory(root)
		const search = root.querySelector<HTMLInputElement>("input")!
		const artist = root.querySelector<HTMLSelectElement>('[name="artist"]')!
		const visible = () => [...root.querySelectorAll("article")].filter((card) => !card.hidden)
		expect(root.querySelector("article")?.dataset.title).toBe("Never Gonna Give You Up")
		search.value = "rick up"
		search.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
		expect(visible()).toHaveLength(1)
		expect(root.querySelector(".more")?.getAttribute("href")).toBe("/harmoneasy/play/rick-up/")
		search.value = "twinkle"
		artist.value = "Rick Astley"
		artist.dispatchEvent(new Event(EVENT_CHANGE, { bubbles: true }))
		expect(visible()).toHaveLength(0)
		expect(root.querySelector<HTMLElement>(".empty")?.hidden).toBe(false)
		root.querySelector("button")!.click()
		expect(visible()).toHaveLength(2)
		expect(root.querySelector('[role="status"]')?.textContent).toBe("2 tracks")
	})
})