export function roomFallbackHtml(roomPath, playPath) {
	const target = JSON.stringify(roomPath).replace(/</g, "\\u003c")
	const play = JSON.stringify(playPath).replace(/</g, "\\u003c")
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open Harmoneasy</title>
</head>
<body>
  <p>Opening Harmoneasy…</p>
  <p><a id="room-link">Open Harmoneasy</a></p>
  <script>
    const play = ${play};
    const playing = location.pathname.startsWith(play);
    const destination = new URL(playing ? play : ${target}, location.origin);
    destination.search = location.search;
    if (playing) {
      // The app restores the readable /play/{artist}/{title} address.
      destination.searchParams.set("play", location.pathname.slice(play.length));
    }
    destination.hash = location.hash;
    document.getElementById('room-link').href = destination.href;
    location.replace(destination.href);
  </script>
  <noscript>Enable JavaScript to use Harmoneasy.</noscript>
</body>
</html>
`
}

/** Publish real static entry points so room and play links work on GitHub Pages. */
export function roomPagesPlugin() {
	let base = "/"
	let publicDir = resolve(import.meta.dirname, "../public")
	let cached
	const directory = () => {
		const localJson = readFileSync(resolve(publicDir, "midi/index.json"), "utf8")
		const remoteJson = readFileSync(resolve(publicDir, "midi/bitmidi-catalogue.json"), "utf8")
		if (cached?.localJson === localJson && cached?.remoteJson === remoteJson) {
			return cached
		}
		const local = JSON.parse(localJson)
		const catalogue = JSON.parse(remoteJson)
		const songs = catalogue.songs.map((song) => ({
			name: song.name.replace(/\.(mid|midi)$/i, ""),
			artist: song.name.includes(" - ") ? song.name.split(" - ")[0] : "Not specified",
			category: "BitMidi catalogue",
			route: `play/bitmidi/${song.slug}`
		}))
		const tracks = [...local, ...songs].sort((a, b) => a.name.localeCompare(b.name))
		const json = JSON.stringify(playDirectoryCatalogue(tracks))
		const hash = createHash("sha256").update(json).digest("hex").slice(0, 16)
		const fileName = `play/catalogue-${hash}.json`
		cached = {
			localJson,
			remoteJson,
			json,
			fileName,
			html: playDirectoryHtml(tracks, base, `${base}${fileName}`)
		}
		return cached
	}
	return {
		name: "harmoneasy-room-pages",
		enforce: "post",
		configResolved(config) {
			base = config.base
			publicDir = config.publicDir ?? publicDir
		},
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const url = new URL(request.url, "http://localhost")
				if (url.pathname.startsWith(`${base}play/catalogue-`)) {
					const assets = directory()
					if (url.pathname !== `${base}${assets.fileName}`) {
						return next()
					}
					response.setHeader("Content-Type", "application/json")
					response.setHeader("Cache-Control", "public, max-age=31536000, immutable")
					response.end(assets.json)
					return
				}
    const playRoot = `${base}play/`
    const suffix = url.pathname.startsWith(playRoot) ? url.pathname.slice(playRoot.length).replace(/\/$/, "") : ""
    const indexPath = [`${base}play`, playRoot, `${playRoot}index.html`].includes(url.pathname)
    const artistPath = url.pathname.startsWith(playRoot) && suffix && !suffix.includes("/") && suffix !== "index.html"
    const redirected = url.searchParams.get("play")?.split("/").filter(Boolean) ?? []
    if ((!indexPath && !artistPath) || redirected.length > 1) {
     return next()
    }
				response.setHeader("Content-Type", "text/html; charset=utf-8")
				response.end(directory().html)
			})
		},
		generateBundle(_options, bundle) {
			const entry = bundle["index.html"]
			if (!entry || entry.type !== "asset") {
				throw new Error("Missing Harmoneasy HTML entry point")
			}
			this.emitFile({ type: "asset", fileName: "room/index.html", source: entry.source })
			const assets = directory()
			this.emitFile({ type: "asset", fileName: "play/index.html", source: assets.html })
			this.emitFile({ type: "asset", fileName: assets.fileName, source: assets.json })
			this.emitFile({
				type: "asset",
				fileName: "404.html",
				source: roomFallbackHtml(`${base}room/`, `${base}play/`)
			})
		}
	}
}
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { playDirectoryHtml, playDirectoryCatalogue } from "./play-directory.js"