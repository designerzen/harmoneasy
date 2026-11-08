export function roomFallbackHtml(roomPath, playPath) {
	const target = JSON.stringify(roomPath).replace(/</g, "\\u003c")
	const play = JSON.stringify(playPath).replace(/</g, "\\u003c")
	const tokens = readFileSync(
		resolve(import.meta.dirname, "../source/assets/style/tokens.css"),
		"utf8"
	)
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Loading Harmoneasy</title>
  <style>
    ${tokens}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100svh;
      display: grid;
      place-items: center;
      background: var(--col-bg);
      color: var(--col-fg);
      font: 16px/1.5 system-ui, sans-serif;
      text-align: center;
    }
    main { padding: 32px 24px; }
    .equalizer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 64px;
      margin-bottom: 24px;
      color: var(--col-accent);
    }
    .equalizer span {
      width: 6px;
      height: 48px;
      border-radius: 3px;
      background: currentColor;
      animation: equalize 1s ease-in-out infinite;
    }
    .equalizer span:nth-child(2) { animation-delay: -0.8s; }
    .equalizer span:nth-child(3) { animation-delay: -0.6s; }
    .equalizer span:nth-child(4) { animation-delay: -0.4s; }
    .equalizer span:nth-child(5) { animation-delay: -0.2s; }
    h1 { margin: 0; font-size: 24px; font-weight: 600; }
    p { margin: 12px 0 0; color: var(--col-muted); }
    a { color: var(--col-muted); text-underline-offset: 4px; font-size: 14px; }
    a:hover { color: var(--col-accent); }
    a:focus-visible { outline: 2px solid var(--col-accent); outline-offset: 6px; }
    noscript { display: block; margin-top: 16px; }
    @keyframes equalize {
      0%, 100% { transform: scaleY(0.3); }
      50% { transform: scaleY(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .equalizer span { animation: none; transform: scaleY(0.4); }
      .equalizer span:nth-child(2n) { transform: scaleY(0.7); }
      .equalizer span:nth-child(3) { transform: scaleY(1); }
    }
  </style>
</head>
<body>
  <main>
    <div role="status" aria-live="polite">
      <div class="equalizer" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <h1>Loading Harmoneasy…</h1>
    </div>
    <p><a id="room-link">Open Harmoneasy</a></p>
    <noscript>Enable JavaScript to use Harmoneasy.</noscript>
  </main>
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
			artist:
				song.artist ??
				(/^abba[-_. ]/i.test(song.name)
					? "ABBA"
					: song.name.includes(" - ")
						? song.name.split(" - ")[0]
						: "Not specified"),
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
				const suffix = url.pathname.startsWith(playRoot)
					? url.pathname.slice(playRoot.length).replace(/\/$/, "")
					: ""
				const indexPath = [`${base}play`, playRoot, `${playRoot}index.html`].includes(
					url.pathname
				)
				const artistPath =
					url.pathname.startsWith(playRoot) &&
					suffix &&
					!suffix.includes("/") &&
					suffix !== "index.html"
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