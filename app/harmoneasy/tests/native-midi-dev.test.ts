import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { fileURLToPath } from 'node:url'

describe('optional native MIDI imports in the web dev server', () => {
    let server: ViteDevServer
    let baseUrl: string

    beforeAll(async () => {
        server = await createServer({
            configFile: fileURLToPath(new URL('../vite.config.web.js', import.meta.url)),
            server: { host: '127.0.0.1', port: 0, watch: null },
            optimizeDeps: { noDiscovery: true, include: [] },
            logLevel: 'silent'
        })
        await server.listen()
        const address = server.httpServer!.address()
        if (!address || typeof address === 'string') throw new Error('Missing dev server address')
        baseUrl = `http://127.0.0.1:${address.port}`
    })

    afterAll(async () => { await server?.close() })

    it.each([
        'inputs/input-midi2-native-device.ts',
        'inputs/input-native-midi-device.ts',
        'inputs/input-midi-transport-clock.ts',
        'outputs/output-midi2-native-device.ts',
        'outputs/output-native-midi-device.ts'
    ])('transforms %s without a native binary', async file => {
        const path = fileURLToPath(new URL(`../../../packages/audiobus/io/${file}`, import.meta.url)).replaceAll('\\', '/')
        const response = await fetch(`${baseUrl}/@fs/${path}`)
        expect(response.status).toBe(200)
        const code = await response.text()
        expect(code).toContain('/@id/__x00__web-native-addon-unavailable')
        expect(code).not.toContain('build/Release/midi2-native.node')
    })

    it('rejects native loading with a catchable error rather than a missing-module overlay', async () => {
        const response = await fetch(`${baseUrl}/@id/__x00__web-native-addon-unavailable`)
        expect(response.status).toBe(200)
        const code = await response.text()
        expect(code).toContain('Native Node.js addons are unavailable in the web app')
        const moduleUrl = 'data:text/javascript,' + encodeURIComponent(code)
        await expect(import(/* @vite-ignore */ moduleUrl)).rejects.toThrow('Native Node.js addons are unavailable')
    })
})
