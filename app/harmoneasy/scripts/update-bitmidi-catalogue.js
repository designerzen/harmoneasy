import { readFile, writeFile } from "node:fs/promises"
import {
	POPULAR_ARTISTS,
	POPULAR_ARTIST_SOURCES,
	artistSearchQueries,
	popularArtistForTitle
} from "./popular-artists.js"

const destination = new URL("../public/midi/bitmidi-catalogue.json", import.meta.url)
const existing = JSON.parse(await readFile(destination, "utf8"))
const songs = new Map(existing.songs.map((song) => [song.id, song]))
const readPage = async (url) => {
	for (let attempt = 0; attempt < 3; attempt++) {
		const response = await fetch(url)
		if (response.ok) {
			return (await response.json()).result
		}
		if (attempt === 2) {
			throw new Error(`BitMidi catalogue: ${response.status}`)
		}
	}
}
const add = (song) => {
	const artist = popularArtistForTitle(song.name)
	songs.set(song.id, {
		id: song.id,
		name: song.name,
		slug: song.slug,
		...(artist ? { artist } : {})
	})
}
// Artist searches extend the existing snapshot instead of discarding previous additions.
if (process.argv.includes("--refresh-popular")) {
	let nextPage = 0
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			while (nextPage < 200) {
				const result = await readPage(
					`https://bitmidi.com/api/midi/all?pageSize=50&page=${nextPage++}`
				)
				result.results.forEach(add)
			}
		})
	)
}
let nextArtist = 0
await Promise.all(
	Array.from({ length: 4 }, async () => {
		while (nextArtist < POPULAR_ARTISTS.length) {
			const artist = POPULAR_ARTISTS[nextArtist++]
			for (const query of artistSearchQueries(artist)) {
				const first = await readPage(
					`https://bitmidi.com/api/midi/search?q=${encodeURIComponent(query)}&pageSize=50&page=0`
				)
				first.results.filter((song) => popularArtistForTitle(song.name)).forEach(add)
				for (let page = 1; page < first.pageTotal; page++) {
					const result = await readPage(
						`https://bitmidi.com/api/midi/search?q=${encodeURIComponent(query)}&pageSize=50&page=${page}`
					)
					result.results.filter((song) => popularArtistForTitle(song.name)).forEach(add)
				}
			}
		}
	})
)
for (const song of songs.values()) {
	const artist = popularArtistForTitle(song.name)
	if (artist) {
		song.artist = artist
	}
}
const coverage = POPULAR_ARTISTS.map((artist) => ({
	artist,
	tracks: [...songs.values()].filter((song) => song.artist === artist).length
}))
await writeFile(
	destination,
	JSON.stringify({
		source: "https://bitmidi.com",
		updatedAt: new Date().toISOString(),
		artistSources: POPULAR_ARTIST_SOURCES,
		artistSearchQueries,
		artistCoverage: coverage,
		songs: [...songs.values()].sort((a, b) => a.name.localeCompare(b.name))
	}) + "\n"
)
console.log(
	JSON.stringify({
		tracks: songs.size,
		artistsSearched: coverage.length,
		represented: coverage.filter((artist) => artist.tracks).length,
		unavailable: coverage.filter((artist) => !artist.tracks).map((artist) => artist.artist)
	})
)