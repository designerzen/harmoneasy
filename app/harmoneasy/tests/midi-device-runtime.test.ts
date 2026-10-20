// @vitest-environment happy-dom
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMidiDeviceStore } from '../electron/midi-device-files.js'
import { useTestMidiProfileFiles, publicMidiDevices } from './midi-profile-runtime-setup'
import { ensureMidiDeviceProfile, loadMidiProfilesForPorts, MIDI_DEVICE_PROFILES, refreshMidiDeviceProfiles, setMidiDeviceProfileSource } from '../../../packages/audiobus/midi/device-profiles'
import { INPUT_FACTORIES, createInputById } from '../../../packages/audiobus/io/input-factory'
import { INPUT_DEFINITIONS } from '../../../packages/audiobus/io/input-definitions'
import { INPUT_GUIDANCE } from '../source/components/graph/device-card'

const temporary: string[] = []
afterEach(async () => {
    useTestMidiProfileFiles()
    for (const folder of temporary.splice(0)) {
        if (path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('harmoneasy-midi-')) throw new Error('Unexpected temporary directory')
        await rm(folder, { recursive: true, force: true })
    }
    vi.unstubAllGlobals()
})
const definition = (id: string) => ({
    id, schemaVersion: 1, name: 'Runtime instrument', manufacturerUrl: 'https://example.com/', productUrl: 'https://example.com/instrument',
    icon: 'icon.svg', gui: { type: 'column', children: [{ type: 'image', src: 'panel.svg', alt: 'Panel' }, { type: 'controls' }, { type: 'guide' }] },
    controls: [{ id: 'expression', label: 'Expression', cc: 102 }]
})
async function root() { const folder = await mkdtemp(path.join(os.tmpdir(), 'harmoneasy-midi-')); temporary.push(folder); return folder }
async function add(folder: string, id: string, filename = `${id}.json`) {
    const device = path.join(folder, id); await mkdir(device, { recursive: true })
    await writeFile(path.join(device, filename), JSON.stringify(definition(id)))
    for (const image of ['icon.svg', 'panel.svg']) await writeFile(path.join(device, image), '<svg xmlns="http://www.w3.org/2000/svg"/>')
}
describe('runtime device folders', () => {
    it('discovers folders added after startup without importing or rebuilding application code', async () => {
        const folder = await root()
        useTestMidiProfileFiles([folder, publicMidiDevices])
        await refreshMidiDeviceProfiles(true)
        expect(MIDI_DEVICE_PROFILES['runtime-controller']).toBeUndefined()
        await add(folder, 'runtime-controller')
        await refreshMidiDeviceProfiles(true)
        expect(MIDI_DEVICE_PROFILES['runtime-controller'].name).toBe('Runtime instrument')
        expect(INPUT_FACTORIES.some(factory => factory.id === 'runtime-controller')).toBe(true)
        expect(INPUT_DEFINITIONS['runtime-controller'].icon).toContain('/runtime-controller/icon.svg')
        expect(INPUT_GUIDANCE['runtime-controller'].requirements).toContain('Runtime instrument')
        Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: vi.fn() })
        const input = await createInputById('runtime-controller')
        const gui = await input.createGui!()
        expect(gui.querySelector('img')?.src).toContain('/runtime-controller/panel.svg')
        expect([...gui.querySelectorAll('a')].map(link => link.href)).toEqual(['https://example.com/', 'https://example.com/instrument'])
        await input.destroyGui!()
        delete (navigator as any).requestMIDIAccess
    })
    it('loads directly by connected device ID on a static host with no directory listing', async () => {
        const fetcher = vi.fn(async (url: string) => url.endsWith('/static-runtime/static-runtime.json')
            ? new Response(JSON.stringify(definition('static-runtime'))) : new Response(null, { status: 404 }))
        setMidiDeviceProfileSource('https://static.example/midi-devices/', fetcher as typeof fetch)
        await loadMidiProfilesForPorts([{ id: 'static-runtime' }])
        expect(MIDI_DEVICE_PROFILES['static-runtime'].icon).toBe('https://static.example/midi-devices/static-runtime/icon.svg')
        expect(fetcher).toHaveBeenCalledWith('https://static.example/midi-devices/static-runtime/static-runtime.json', { cache: 'no-store' })
    })
    it('requires each folder JSON to use its ID as the filename', async () => {
        const folder = await root(); await add(folder, 'wrong-name', 'profile.json')
        const store = createMidiDeviceStore(() => [folder])
        expect(await store.list()).toEqual([])
        await add(folder, 'correct-name')
        expect(await store.list()).toEqual(['correct-name'])
        expect(await store.read('../secret.json')).toBeNull()
        expect(await store.read('correct-name/../../secret.json')).toBeNull()
    })
    it('prefers user-supplied device folders and serves images as separate runtime files', async () => {
        const folder = await root(); await add(folder, 'arcana-strum')
        const store = createMidiDeviceStore(() => [folder, publicMidiDevices])
        const file = await store.read('arcana-strum/arcana-strum.json')
        expect(JSON.parse(file!.bytes.toString()).name).toBe('Runtime instrument')
        expect((await store.read('arcana-strum/panel.svg'))?.type).toBe('image/svg+xml')
        expect(await ensureMidiDeviceProfile('../../secret')).toBeUndefined()
    })
})
