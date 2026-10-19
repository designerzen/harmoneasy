const UI_REQUEST = 'webclapUI'
const MIME_TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', wasm: 'application/wasm', woff2: 'font/woff2' }
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
    const prefix = new URL('ui/', self.location.href).href
    if (!event.request.url.startsWith(prefix)) return
    event.respondWith((async () => {
        const relative = event.request.url.slice(prefix.length)
        const [id, kind, ...parts] = relative.split('/')
        const path = '/' + parts.join('/')
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const data = await new Promise(resolve => {
            const ports = []
            const timer = setTimeout(() => finish(null), 5000)
            function finish(value) { clearTimeout(timer); ports.forEach(port => port.close()); resolve(value) }
            for (const client of clients) {
                const channel = new MessageChannel()
                ports.push(channel.port1)
                channel.port1.onmessage = message => finish(message.data.data)
                client.postMessage({ [UI_REQUEST]: true, id, kind, path }, [channel.port2])
            }
        })
        if (data == null) return new Response('Plugin resource unavailable', { status: 404 })
        const ext = new URL(event.request.url).pathname.split('.').pop()
        return new Response(data, { headers: {
            'Content-Type': data.type || MIME_TYPES[ext] || 'application/octet-stream',
            'Cross-Origin-Embedder-Policy': 'credentialless'
        } })
    })())
})
