import { searchBitMidi } from "audiobus/io/transformers/transformer-midi-file-player"
import { parsePresetPage, type PresetPage } from "./preset-page"

const PLAY_TEMPLATE = "presets/songs/twinkle-twinkle-little-star/preset.json"
// Static hosts send unknown /play/{artist}/{title} paths to 404.html, which redirects here.
export const PLAY_REDIRECT_KEY = "play"

export interface PlayRoute {
	artist: string
	// Empty when the link names only an artist, which lists their songs to choose from
	title: string
}

const words = (segment: string) =>
	decodeURIComponent(segment)
		.replace(/[-_+\s]+/g, " ")
		.trim()

/** Read /play/{artist}/{title} or /play/{artist}, or the ?play={artist}/{title} form a static 404 redirect produces. */
export function playRoute(location: string, base: string): PlayRoute | undefined {
	const url = new URL(location)
	const playPath = `${new URL(base, url).pathname.replace(/\/$/, "")}/play/`
	const redirected =
		url.pathname === new URL(base, url).pathname && url.searchParams.has(PLAY_REDIRECT_KEY)
	if (!`${url.pathname}/`.startsWith(playPath) && !redirected) {
		return
	}
	const path =
		url.pathname.slice(playPath.length) || url.searchParams.get(PLAY_REDIRECT_KEY) || ""
	const segments = path.split("/").filter(Boolean)
	const [artist, title = ""] = segments.map(words)
	if (!artist || segments.length > 2 || (segments.length === 2 && !title)) {
		throw new Error("Use a play link in the form /play/{artist} or /play/{artist}/{title}.")
	}
	return {
		artist,
		title: artist.toLowerCase() === "bitmidi" ? decodeURIComponent(segments[1] ?? "") : title
	}
}

/** The readable link for a play route, so redirected links show /play/{artist}/{title} again. */
export function playUrl(route: PlayRoute, base: string, origin: string): URL {
	const segment = (value: string) => encodeURIComponent(value.toLowerCase().replace(/\s+/g, "-"))
	const path = [route.artist, route.title].filter(Boolean).map(segment).join("/")
	return new URL(`${base}play/${path}/`, origin)
}

/**
 * Build a one-key melody preset whose MIDI File Player searches BitMidi for the
 * route and plays the best match. Artist-only routes list the artist's songs without
 * loading one, so the player chooses. Search failures still open the preset with
 * the search shown, so the player can retry or choose another result.
 */
export async function loadPlayPage(
	route: PlayRoute,
	base: string,
	origin: string,
	fetcher = fetch
): Promise<PresetPage> {
	const response = await fetcher(new URL(`${base}${PLAY_TEMPLATE}`, origin).href)
	if (!response.ok) {
		throw new Error(`Could not load the play preset (${response.status})`)
	}
	const page: PresetPage & { source?: { url: string; trackIndex: number } } =
		await response.json()
	const searchQuery = `${route.artist} ${route.title}`.trim()
	const exact = route.artist.toLowerCase() === "bitmidi" && route.title
	const match = exact
		? await fetcher(
				`https://bitmidi.com/api/midi/get?slug=${encodeURIComponent(route.title)}`
			).then(async (response) => {
				if (!response.ok) {
					throw new Error("Could not load this BitMidi track")
				}
				const { result } = await response.json()
				return {
					...result.result,
					downloadUrl: new URL(result.result.downloadUrl, "https://bitmidi.com").href,
					url: new URL(result.result.url, "https://bitmidi.com").href
				}
			})
		: route.title
			? await searchBitMidi(searchQuery)
					.then(({ results }) => results[0])
					.catch(() => undefined)
			: undefined
	if (exact && match) {
		page.name = `${match.name.replace(/\.(mid|midi)$/i, "")} — One-key melody`
		page.description =
			"Press any playing key to play the next melody note of this BitMidi track. Release the key to end the note."
	} else if (route.title) {
		page.name = `${route.title} by ${route.artist} — One-key melody`
		page.description = `Press any playing key to play the next melody note of the closest BitMidi match for “${searchQuery}”. Choose another search result to change the song.`
	} else {
		page.name = `Songs by ${route.artist} — One-key melody`
		page.description = `Choose one of the BitMidi songs matching “${searchQuery}” in the MIDI File Player, then press any playing key to play its melody one note at a time.`
	}
	const chain = page.workspace.chains[0]
	chain.options.name = page.name
	const [config, ...steps] = JSON.parse(chain.transformers)
	chain.transformers = JSON.stringify([
		JSON.stringify({
			...JSON.parse(config),
			midiFileUrl: match?.downloadUrl ?? "",
			midiFileName: match?.name,
			trackIndex: -1,
			searchQuery: exact ? match?.name.replace(/\.(mid|midi)$/i, "") : searchQuery
		}),
		...steps
	])
	page.source = match && { url: match.url, trackIndex: -1 }
	delete page.catalogue
	return parsePresetPage(JSON.stringify(page))
}