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
	return {
		name: "harmoneasy-room-pages",
		enforce: "post",
		configResolved(config) {
			base = config.base
		},
		generateBundle(_options, bundle) {
			const entry = bundle["index.html"]
			if (!entry || entry.type !== "asset") {
				throw new Error("Missing Harmoneasy HTML entry point")
			}
			this.emitFile({ type: "asset", fileName: "room/index.html", source: entry.source })
			this.emitFile({ type: "asset", fileName: "play/index.html", source: entry.source })
			this.emitFile({
				type: "asset",
				fileName: "404.html",
				source: roomFallbackHtml(`${base}room/`, `${base}play/`)
			})
		}
	}
}