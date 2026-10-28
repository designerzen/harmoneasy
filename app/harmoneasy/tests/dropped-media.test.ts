import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { droppedUrl, hasMidiHeader, inspectMediaArchive, safeArchivePath } from '../../../packages/audiobus/importers/dropped-media'
const { zipSync, strToU8 } = createRequire(new URL('../../../packages/audiobus/package.json', import.meta.url))('fflate')
const descriptor = strToU8(JSON.stringify({ name: 'WamExample', apiVersion: '2.0.0', isInstrument: true }))

describe('dropped media formats', () => {
    it('recognizes a built WAM2 bundle inside a wrapper folder without flattening shared assets', async () => {
        const files = {
            'package/plugins/synth101/descriptor.json': descriptor,
            'package/plugins/synth101/index.js': strToU8('export default class Synth {}'),
            'package/plugins/synth101/gui/index.js': strToU8('export default () => document.createElement("div")'),
            'package/plugins/shared/engine.wasm': new Uint8Array([0, 97, 115, 109]),
        }
        const archive = await inspectMediaArchive(zipSync(files))
        expect(archive.plugins).toEqual([{ name: 'WamExample', path: 'package/plugins/synth101/index.js' }])
        expect(archive.files['package/plugins/shared/engine.wasm']).toEqual(files['package/plugins/shared/engine.wasm'])
    })
    it('rejects source-only bundles, effects and legacy plugins with actionable errors', async () => {
        for (const files of [
            { 'descriptor.json': descriptor },
            { 'descriptor.json': strToU8('{"isInstrument":false,"sdkVersion":"2.0.0"}'), 'index.js': strToU8('') },
            { 'descriptor.json': strToU8('{"isInstrument":true,"sdkVersion":"1.0.0"}'), 'index.js': strToU8('') },
        ]) await expect(inspectMediaArchive(zipSync(files))).rejects.toThrow('No ready-to-run WAM2 instrument')
    })
    it('uses MIDI content instead of requiring a trustworthy name or MIME type', async () => {
        expect(await hasMidiHeader(new Blob(['MThd0000']))).toBe(true)
        expect(await hasMidiHeader(new Blob(['not MIDI']))).toBe(false)
        const archive = await inspectMediaArchive(zipSync({ 'song.bin': strToU8('MThd0000') }))
        expect(archive.midi).toEqual(['song.bin'])
    })
    it('rejects traversal, ambiguous URL paths, unsupported containers and oversized archive listings', async () => {
        for (const path of ['../escape.js', '/root.js', 'a/../index.js', 'a\\b.js', 'a%2fb.js', 'a?b.js']) expect(() => safeArchivePath(path)).toThrow('Unsafe')
        await expect(inspectMediaArchive(new Uint8Array([0x1f, 0x8b]))).rejects.toThrow('Expected a ZIP')
        await expect(inspectMediaArchive(zipSync({ '../escape.js': strToU8('oops') }))).rejects.toThrow('Unsafe')
        const files = Object.fromEntries(Array.from({ length: 4097 }, (_, index) => [`${index}.txt`, strToU8('')]))
        await expect(inspectMediaArchive(zipSync(files))).rejects.toThrow('too many files')
    })
    it('reads URI lists without treating internal graph data or arbitrary text as URLs', () => {
        expect(droppedUrl('# a comment\r\nhttps://example.com/synth/index.js\r\n')).toBe('https://example.com/synth/index.js')
        expect(droppedUrl('', 'https://example.com/descriptor.json')).toBe('https://example.com/descriptor.json')
        expect(droppedUrl('', 'legacy:yoshimi')).toBe('legacy:yoshimi')
        expect(droppedUrl('', 'javascript:alert(1)')).toBeUndefined()
        expect(droppedUrl('', '{"type":"graph-node"}')).toBeUndefined()
    })
})
