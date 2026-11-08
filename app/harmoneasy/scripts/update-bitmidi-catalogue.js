import { writeFile } from "node:fs/promises"

// Snapshot the 10,000 most-played records; MIDI bytes download only when selected.
const songs = new Map()
let nextPage = 0
await Promise.all(
	Array.from({ length: 4 }, async () => {
		while (nextPage < 200) {
			const page = nextPage++
			const response = await fetch(
				`https://bitmidi.com/api/midi/all?pageSize=50&page=${page}`
			)
			if (!response.ok) {
				throw new Error(`BitMidi catalogue page ${page}: ${response.status}`)
			}
			const { result } = await response.json()
			for (const song of result.results) {
				songs.set(song.id, { id: song.id, name: song.name, slug: song.slug })
			}
		}
	})
)
if (songs.size < 9000) {
	throw new Error("Incomplete BitMidi catalogue; keeping the existing snapshot")
}
await writeFile(
	new URL("../public/midi/bitmidi-catalogue.json", import.meta.url),
	JSON.stringify({
		source: "https://bitmidi.com",
		updatedAt: new Date().toISOString(),
		songs: [...songs.values()].sort((a, b) => a.name.localeCompare(b.name))
	}) + "\n"
)
console.log(`Saved ${songs.size} BitMidi song links`)