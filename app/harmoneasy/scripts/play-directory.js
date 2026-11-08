import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(char) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;"
			})[char]
	)

export function playArtistEntries(songs) {
	const groups = new Map()
	for (const song of songs) {
		if (!song.artist || song.artist === "Not specified") {
			continue
		}
		const key = song.artist.toLowerCase()
		if (!groups.has(key)) {
			groups.set(key, {
				name: song.artist,
				artist: song.artist,
				category: song.category,
				categories: [],
				count: 0,
				route: `play/${encodeURIComponent(key.replace(/\s+/g, "-"))}`
			})
		}
		const group = groups.get(key)
		group.count++
		if (!group.categories.includes(song.category)) {
			group.categories.push(song.category)
		}
	}
	return [...groups.values()]
}

export function playDirectoryCatalogue(songs) {
	const artists = [...new Set(songs.map((song) => song.artist))].sort()
	const categories = [...new Set(songs.map((song) => song.category))].sort()
	const ordered = [...songs].sort((a, b) => a.name.localeCompare(b.name))
	return {
		artists,
		categories,
		tracks: ordered.map((song) => [
			song.name,
			song.route.replace(/^play\/bitmidi\//, ""),
			artists.indexOf(song.artist),
			categories.indexOf(song.category)
		]),
		artistOrder: ordered
			.map((_, index) => index)
			.sort((a, b) => ordered[a].artist.localeCompare(ordered[b].artist))
	}
}

export async function loadPlayDirectory(root, url, fetcher = fetch) {
	root.querySelector('[role="status"]').textContent = "Loading full catalogue…"
	try {
		const response = await fetcher(url, { cache: "force-cache" })
		if (!response.ok) {
			throw new Error("Catalogue unavailable")
		}
		const data = await response.json()
		const songs = data.tracks.map(([name, route, artist, category]) => ({
			name,
			route: route.startsWith("presets/") ? route : `play/bitmidi/${route}`,
			artist: data.artists[artist],
			category: data.categories[category]
		}))
		for (const [key, values] of [
			["artist", data.artists],
			["category", data.categories]
		]) {
			const select = root.querySelector(`[name="${key}"]`)
			const selected = select.value
			while (select.options.length > 1) {
				select.remove(1)
			}
			for (const value of values) {
				const option = document.createElement("option")
				option.value = value
				option.textContent = value
				select.append(option)
			}
			select.value = selected
		}
		mountPlayDirectory(
			root,
			root.dataset.view === "artists" ? playArtistEntries(songs) : songs,
			root.dataset.view === "artists" ? undefined : data.artistOrder
		)
		const retry = root.querySelector(".retry")
		if (retry) {
			retry.hidden = true
		}
	} catch {
		root.querySelector('[role="status"]').textContent =
			"Full catalogue could not load. The displayed tracks still work."
		const retry = root.querySelector(".retry")
		if (retry) {
			retry.hidden = false
			retry.onclick = () => loadPlayDirectory(root, url, fetcher)
		}
	}
}

export function mountPlayDirectory(root, songs, artistOrder) {
	const form = root.querySelector("form")
	const search = form.elements.namedItem("q")
	const artist = form.elements.namedItem("artist")
	const category = form.elements.namedItem("category")
	const sort = form.elements.namedItem("sort")
	const cards = [...root.querySelectorAll("article")]
	const list = root.querySelector(".tracks")
	const entries =
		songs ??
		cards.map((card) => ({
			name: card.dataset.title,
			artist: card.dataset.artist,
			category: card.dataset.category,
			element: card
		}))
	const searchText = new Map(
		entries.map((song) => [song, `${song.name} ${song.artist} ${song.category}`.toLowerCase()])
	)
	const titleOrder = artistOrder
		? entries
		: [...entries].sort((a, b) => a.name.localeCompare(b.name))
	const byArtist = artistOrder
		? artistOrder.map((index) => entries[index])
		: [...titleOrder].sort((a, b) => a.artist.localeCompare(b.artist))
	const byCount = [...titleOrder].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
	const letters = new Map(
		entries.map((song) => {
			const initial = song.name
				.replace(/^the\s+/i, "")
				.normalize("NFD")
				.replace(/[\u0300-\u036f]/g, "")
				.charAt(0)
				.toUpperCase()
			return [song, /^[A-Z]$/.test(initial) ? initial : "#"]
		})
	)
	const pageSize = 60
	let page = 0
	let matches = []
	const render = () => {
		if (songs) {
			list.replaceChildren()
			for (const song of matches.slice(page * pageSize, (page + 1) * pageSize)) {
				const card = document.createElement("article")
				const tag = document.createElement("span")
				tag.className = "tag"
				tag.textContent = song.count ? `${song.count} tracks` : song.category
				const heading = document.createElement("h2")
				const link = document.createElement("a")
				link.className = "card-action"
				link.href = `${root.dataset.base}${song.route}/${song.count ? "" : "?start=1"}`
				heading.textContent = song.name
				const credit = document.createElement("p")
				credit.textContent = song.count ? song.categories.join(" · ") : song.artist
				const open = document.createElement("span")
				open.className = "open"
				open.textContent = song.count ? "Browse songs →" : "Play this track →"
				link.append(tag, heading, credit, open)
				card.append(link)
				list.append(card)
			}
		} else {
			for (const card of cards) {
				card.hidden = true
			}
			for (const song of matches) {
				song.element.hidden = false
				list.append(song.element)
			}
		}
		const count = matches.length
		root.querySelector('[role="status"]').textContent =
			`${count.toLocaleString()} ${root.dataset.view === "artists" ? (count === 1 ? "artist" : "artists") : count === 1 ? "track" : "tracks"}`
		root.querySelector(".empty").hidden = count !== 0
		const previous = root.querySelector(".previous")
		const next = root.querySelector(".next")
		if (previous) {
			previous.disabled = page === 0
			next.disabled = (page + 1) * pageSize >= count
			root.querySelector(".page-number").textContent =
				`Page ${page + 1} of ${Math.max(1, Math.ceil(count / pageSize))}`
		}
	}
	const update = () => {
		const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
		matches = (
			sort.value === "count" ? byCount : sort.value === "artist" ? byArtist : titleOrder
		).filter(
			(song) =>
				words.every((word) => searchText.get(song).includes(word)) &&
				(root.dataset.view !== "artists" ||
					!root.dataset.letter ||
					letters.get(song) === root.dataset.letter) &&
				(!artist.value || artist.value === song.artist) &&
				(!category.value ||
					category.value === song.category ||
					song.categories?.includes(category.value))
		)
		for (const link of root.querySelectorAll("[data-letter]")) {
			if (link.dataset.letter === (root.dataset.letter ?? "")) {
				link.setAttribute("aria-current", "page")
			} else {
				link.removeAttribute("aria-current")
			}
		}
		page = 0
		render()
		const more = root.querySelector(".more")
		more.hidden = root.dataset.view === "artists" || !search.value.trim()
		more.href = `${root.dataset.base}play/${encodeURIComponent(search.value.trim().replace(/\s+/g, "-"))}/`
	}
	const selectLetter = (letter) => {
		root.dataset.letter = letter
		const history = globalThis.history
		if (history?.replaceState) {
			const url = new URL(globalThis.location.href)
			if (letter) {
				url.searchParams.set("letter", letter)
			} else {
				url.searchParams.delete("letter")
			}
			history.replaceState(history.state, "", url)
		}
		update()
	}
	form.oninput = update
	form.onchange = update
	form.onsubmit = (event) => event.preventDefault()
	root.querySelector("button").onclick = () => {
		form.reset()
		selectLetter("")
		search.focus()
	}
	for (const link of root.querySelectorAll("[data-letter]")) {
		link.onclick = (event) => {
			event.preventDefault()
			selectLetter(link.dataset.letter)
		}
	}
	const previous = root.querySelector(".previous")
	if (previous) {
		previous.onclick = () => {
			if (page > 0) {
				page--
				render()
			}
		}
		root.querySelector(".next").onclick = () => {
			if ((page + 1) * pageSize < matches.length) {
				page++
				render()
			}
		}
	}
	update()
}

export function playDirectoryHtml(songs, base, catalogueUrl = `${base}play/catalogue.json`) {
	const tokens = readFileSync(
		resolve(import.meta.dirname, "../source/assets/style/tokens.css"),
		"utf8"
	)
	const options = (key) =>
		[...new Set(songs.slice(0, 60).map((song) => song[key]))]
			.sort()
			.map((value) => `<option>${escapeHtml(value)}</option>`)
			.join("")
	const artists = playArtistEntries(songs).sort((a, b) => a.name.localeCompare(b.name))
	const cards = artists
		.slice(0, 60)
		.map(
			(
				song
			) => `<article data-title="${escapeHtml(song.name)}" data-search="${escapeHtml(`${song.name} ${song.artist} ${song.category}`.toLowerCase())}" data-artist="${escapeHtml(song.artist)}" data-category="${escapeHtml(song.category)}">
<a class="card-action" href="${escapeHtml(`${base}${song.route}/`)}"><span class="tag">${song.count} tracks</span><h2>${escapeHtml(song.name)}</h2><p>${escapeHtml(song.artist)}</p><span class="open">Browse songs →</span></a></article>`
		)
		.join("\n")
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Play a melody · Harmoneasy</title>
<script>const requestedPlay = new URLSearchParams(location.search).get("play");if(requestedPlay && requestedPlay.split("/").filter(Boolean).length > 1){location.replace(${JSON.stringify(base)}+location.search+location.hash)}</script>
<style>${tokens}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--col-bg);color:var(--col-fg);font:16px/1.5 system-ui,sans-serif}main,header{max-width:1100px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;border-bottom:1px solid var(--col-line-strong)}a{color:var(--col-accent);text-underline-offset:4px}h1{font-size:clamp(32px,5vw,56px);line-height:1.1;margin:20px 0}h2{font-size:22px;line-height:1.3}h2 a{color:var(--col-fg);text-decoration:none}p,.tag{color:var(--col-muted)}form{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:12px;margin:28px 0 16px}label{display:grid;gap:6px}input,select,button{font:inherit;background:var(--col-surface);color:var(--col-fg);border:1px solid var(--col-line-strong);border-radius:8px;padding:12px;min-width:0}button{cursor:pointer}.bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.tracks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}article{display:flex;flex-direction:column;border:1px solid var(--col-line-strong);background:var(--col-surface);border-radius:12px;overflow:hidden}.card-action{display:flex;flex-direction:column;flex:1;padding:24px;color:var(--col-fg);text-decoration:none}.card-action:hover{background:var(--col-surface-raised)}.card-action:focus-visible{outline-offset:-4px}.card-action .open{color:var(--col-accent)}article p{margin-top:0}.open{margin-top:auto;padding-top:20px}.tag{font-size:13px}.empty{padding:32px 0}:focus-visible{outline:2px solid var(--col-accent);outline-offset:4px}.artist-alphabet{display:flex;flex-wrap:wrap;gap:6px;margin-top:24px}.artist-alphabet a{padding:6px 10px;border:1px solid var(--col-line-strong);border-radius:6px;text-decoration:none}.artist-alphabet [aria-current]{background:var(--col-accent);color:var(--col-bg)}.more{display:inline-block;margin-top:24px}@media(max-width:760px){form{grid-template-columns:1fr 1fr}.tracks{grid-template-columns:1fr 1fr}label:first-child{grid-column:1/-1}}@media(max-width:480px){.tracks{grid-template-columns:1fr}main,header{padding:18px}}
</style></head><body><header><a href="${base}">Harmoneasy</a><a href="${base}play/">Artists A–Z</a><a href="${base}play/?tracks=1">Browse all tracks</a><a href="${base}presets/">All presets</a></header>
<main data-base="${escapeHtml(base)}" data-view="artists"><h1>Find an artist.</h1><p>Browse artists, choose a song, then play its melody one note at a time. Explore ${songs.length.toLocaleString()} tracks.</p>
<nav class="artist-alphabet" aria-label="Artists by letter">${["", "#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `<a data-letter="${letter}" href="${base}play/${letter ? `?letter=${encodeURIComponent(letter)}` : ""}">${letter || "All"}</a>`).join("")}</nav>
<form role="search"><label><span class="search-label">Search artists</span><input type="search" name="q" placeholder="Song title or artist…" autocomplete="off"></label><label class="artist-filter" hidden>Artist<select name="artist"><option value="">All artists</option>${options("artist")}</select></label><label>Collection<select name="category"><option value="">All collections</option>${options("category")}</select></label><label>Sort by<select name="sort"><option value="title">Name</option><option value="count">Most tracks</option></select></label></form>
<div class="bar"><span role="status" aria-live="polite">${artists.length.toLocaleString()} artists</span><button type="button">Clear filters</button></div><div class="tracks">${cards}</div><nav aria-label="Track pages" class="bar"><button class="previous" type="button">Previous</button><span class="page-number"></span><button class="next" type="button">Next</button></nav><button type="button" class="retry" hidden>Retry loading catalogue</button><p class="empty" hidden>No results match. Try another search or clear the filters.</p><a class="more" hidden>Find more matching songs on BitMidi →</a><noscript><p>Enable JavaScript to search and filter. The first 60 track links work without it; enable JavaScript to browse the full catalogue.</p></noscript></main>
<script type="module">${playArtistEntries.toString()}
${mountPlayDirectory.toString()}
${loadPlayDirectory.toString()}
const root = document.querySelector("main");
root.dataset.letter = new URLSearchParams(location.search).get("letter") || "";
const playPath = ${JSON.stringify(`${base}play/`)};
const artistPath = new URLSearchParams(location.search).get("play") || (location.pathname.startsWith(playPath) ? location.pathname.slice(playPath.length) : "");
const artistSegments = artistPath.split("/").filter(Boolean);
if ((artistSegments.length === 1 && artistSegments[0] !== "index.html") || new URLSearchParams(location.search).has("tracks")) {
 const artist = artistSegments[0] && artistSegments[0] !== "index.html" ? decodeURIComponent(artistSegments[0]).replace(/[-_+]+/g," ") : "";
 root.dataset.view = "tracks";
 root.querySelector(".artist-alphabet").hidden = true;
 root.querySelector(".search-label").textContent = "Search tracks";
 root.querySelector(".artist-filter").hidden = false;
 root.querySelector('[name="sort"]').innerHTML = '<option value="title">Title</option><option value="artist">Artist</option>';
 root.querySelector('[name="q"]').value = artist;
 root.querySelector("h1").textContent = artist ? "Songs matching “" + artist + "”" : "All songs";
 document.title = "Songs matching " + artist + " · Harmoneasy";
}
mountPlayDirectory(root);
loadPlayDirectory(root, ${JSON.stringify(catalogueUrl).replaceAll("<", "\\u003c")});</script></body></html>`
}