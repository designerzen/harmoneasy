export function roomFallbackHtml(roomPath) {
    const target = JSON.stringify(roomPath).replace(/</g, '\\u003c')
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
    const destination = new URL(${target}, location.origin);
    destination.search = location.search;
    destination.hash = location.hash;
    document.getElementById('room-link').href = destination.href;
    location.replace(destination.href);
  </script>
  <noscript>Enable JavaScript to use Harmoneasy.</noscript>
</body>
</html>
`
}

/** Publish real static entry points so room links work on GitHub Pages. */
export function roomPagesPlugin() {
    let base = '/'
    return {
        name: 'harmoneasy-room-pages',
        enforce: 'post',
        configResolved(config) { base = config.base },
        generateBundle(_options, bundle) {
            const entry = bundle['index.html']
            if (!entry || entry.type !== 'asset') throw new Error('Missing Harmoneasy HTML entry point')
            this.emitFile({ type: 'asset', fileName: 'room/index.html', source: entry.source })
            this.emitFile({ type: 'asset', fileName: '404.html', source: roomFallbackHtml(`${base}room/`) })
        }
    }
}
