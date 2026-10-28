import { WAM_ARCHIVE_CACHE, WAM_ARCHIVE_DIRECTORY } from 'audiobus/wam/archive-files.js'
import { safeArchivePath } from 'audiobus/importers/dropped-media'
import { EVENT_CONTROLLER_CHANGE, EVENT_STATE_CHANGE } from 'audiobus/event-constants'

const mimeTypes: Record<string, string> = {
    js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', wasm: 'application/wasm',
    html: 'text/html', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2',
    wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg',
}

async function archiveWorker(): Promise<void> {
    if (!navigator.serviceWorker || !globalThis.caches) throw new Error('Local WAM bundles require HTTPS or localhost. You can also drop a hosted plugin URL.')
    const script = new URL(`${import.meta.env.BASE_URL}coi-serviceworker.js`, document.baseURI)
    const registration = await navigator.serviceWorker.register(script.href)
    const worker = registration.installing ?? registration.waiting ?? registration.active
    if (!worker) throw new Error('WAM bundle loader is unavailable')
    if (worker.state === 'activated' && navigator.serviceWorker.controller?.scriptURL === script.href) return
    await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeout)
            navigator.serviceWorker.removeEventListener(EVENT_CONTROLLER_CHANGE, check)
            worker.removeEventListener(EVENT_STATE_CHANGE, check)
        }
        const check = () => {
            if (worker.state === 'redundant') { cleanup(); reject(new Error('WAM bundle loader failed to activate')); return }
            if (worker.state !== 'activated' || navigator.serviceWorker.controller?.scriptURL !== script.href) return
            cleanup(); resolve()
        }
        const timeout = setTimeout(() => { cleanup(); reject(new Error('WAM bundle loader could not activate. Reload the page and retry.')) }, 15000)
        navigator.serviceWorker.addEventListener(EVENT_CONTROLLER_CHANGE, check)
        worker.addEventListener(EVENT_STATE_CHANGE, check)
        check()
    })
}

export async function storeWamArchive(files: Record<string, Uint8Array>, entry: string): Promise<{ url: string; rollback: () => Promise<void> }> {
    await archiveWorker()
    const prefix = new URL(`${import.meta.env.BASE_URL}${WAM_ARCHIVE_DIRECTORY}${crypto.randomUUID()}/`, document.baseURI)
    const cache = await caches.open(WAM_ARCHIVE_CACHE)
    const urls: string[] = []
    const rollback = async () => { await Promise.all(urls.map(url => cache.delete(url))) }
    try {
        for (const [path, data] of Object.entries(files)) {
            const url = new URL(safeArchivePath(path).split('/').map(encodeURIComponent).join('/'), prefix).href
            urls.push(url)
            const type = mimeTypes[path.split('.').pop()!.toLowerCase()] || 'application/octet-stream'
            await cache.put(url, new Response(new Blob([new Uint8Array(data)], { type }), { headers: {
                'Content-Type': type, 'Cross-Origin-Resource-Policy': 'same-origin',
                'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Opener-Policy': 'same-origin',
            } }))
        }
        return { url: new URL(safeArchivePath(entry).split('/').map(encodeURIComponent).join('/'), prefix).href, rollback }
    } catch (error) { await rollback(); throw error }
}
