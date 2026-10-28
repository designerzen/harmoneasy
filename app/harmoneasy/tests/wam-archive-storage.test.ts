import { afterEach, expect, it, vi } from 'vitest'
import { storeWamArchive } from '../source/services/wam-archive'
import { WAM_ARCHIVE_CACHE } from '../../../packages/audiobus/wam/archive-files.js'
afterEach(() => vi.unstubAllGlobals())

function setup() {
    const scriptURL = new URL(`${import.meta.env.BASE_URL}coi-serviceworker.js`, 'https://example.com/harmoneasy/').href
    vi.stubGlobal('document', { baseURI: 'https://example.com/harmoneasy/' })
    vi.stubGlobal('navigator', { serviceWorker: { controller: { scriptURL }, register: vi.fn(async () => ({ active: { state: 'activated' } })) } })
    const cache = { put: vi.fn(), delete: vi.fn(async () => true) }
    const open = vi.fn(async () => cache)
    vi.stubGlobal('caches', { open })
    return { cache, open }
}

it('stores all plugin-relative files with executable MIME types and can roll back a failed import', async () => {
    const { cache, open } = setup()
    const files = { 'bundle/plugin/index.js': new Uint8Array([1]), 'bundle/shared/engine.wasm': new Uint8Array([2]) }
    const stored = await storeWamArchive(files, 'bundle/plugin/index.js')
    expect(open).toHaveBeenCalledWith(WAM_ARCHIVE_CACHE)
    expect(stored.url).toContain('/wam-archives/')
    expect(stored.url).toMatch(/\/bundle\/plugin\/index\.js$/)
    const wasm = cache.put.mock.calls[1]
    expect(wasm[0]).toBe(new URL('../shared/engine.wasm', stored.url).href)
    expect(wasm[1].headers.get('Content-Type')).toBe('application/wasm')
    expect(wasm[1].headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp')
    await stored.rollback()
    expect(cache.delete.mock.calls.map(call => call[0])).toEqual(cache.put.mock.calls.map(call => call[0]))
})
it('rolls back partially cached bundles when storage quota is exceeded', async () => {
    const { cache } = setup()
    cache.put.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Quota exceeded'))
    await expect(storeWamArchive({ 'index.js': new Uint8Array(), 'engine.wasm': new Uint8Array() }, 'index.js')).rejects.toThrow('Quota exceeded')
    expect(cache.delete).toHaveBeenCalledTimes(2)
})
it('reports environments without service worker support clearly', async () => {
    vi.stubGlobal('navigator', {})
    await expect(storeWamArchive({}, 'index.js')).rejects.toThrow('HTTPS or localhost')
})
