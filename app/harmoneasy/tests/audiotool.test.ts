import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOfflineDocument } from '../../../packages/audiotool/node_modules/@audiotool/nexus/dist/index.js'
import { createDiskWasmLoader } from '../../../packages/audiotool/node_modules/@audiotool/nexus/dist/node.js'
import { captureAudioToolTake, appendAudioToolTake, type RecordedCommand } from '../../../packages/audiotool/adapter-audiotool-audio-events-recording'
import { AudioToolConnection } from '../../../packages/audiotool/audio-tool-connect'

const command = (type: string, startAt: number, channel = 1, from = 'Keyboard', velocity = 127): RecordedCommand => ({ type, startAt, channel, from, velocity, number: 60 })
const take = () => captureAudioToolTake([command('noteOn', 40), command('noteOff', 40.5)], 120, 41)
const offline = () => createOfflineDocument({ wasm: createDiskWasmLoader() })
afterEach(() => vi.unstubAllGlobals())

describe('AudioTool take conversion', () => {
    it('pairs overlapping pitches independently by channel and input and preserves velocities', () => {
        const commands = [command('noteOn', 40, 1, 'A', 64), command('noteOn', 40, 2, 'A'), command('noteOn', 40.25, 1, 'B'), command('noteOff', 40.5, 1, 'A'), command('noteOff', 41, 2, 'A'), command('noteOff', 41.5, 1, 'B')]
        const before = JSON.stringify(commands)
        const result = captureAudioToolTake(commands, 120, 42)
        expect(result.notes.map(note => [note.positionTicks, note.durationTicks])).toEqual([[0, 3840], [0, 7680], [1920, 9600]])
        expect(result.notes[0].velocity).toBeCloseTo(64 / 127)
        expect(JSON.stringify(commands)).toBe(before)
    })
    it('pairs repeated same-pitch notes FIFO and treats zero velocity as note off', () => {
        const result = captureAudioToolTake([command('noteOn', 1), command('noteOn', 1.1), command('noteOn', 1.2, 1, 'Keyboard', 0), command('noteOff', 1.5)], 120, 2)
        expect(result.notes.map(note => note.durationTicks)).toEqual([1536, 3072])
    })
    it('separates identical input/channel notes from different chains', async () => {
        const result = captureAudioToolTake([
            { ...command('noteOn', 1), chainId: 'a', chainName: 'Melody' },
            { ...command('noteOn', 1), chainId: 'b', chainName: 'Harmony' },
            { ...command('noteOff', 1.5), chainId: 'b' },
            { ...command('noteOff', 2), chainId: 'a' }
        ], 120, 2)
        expect(result.notes.find(note => note.chainId === 'a')?.durationTicks).toBe(7680)
        expect(result.notes.find(note => note.chainId === 'b')?.durationTicks).toBe(3840)
        const doc = await offline()
        await doc.modify(t => appendAudioToolTake(t, result, { placement: 'start' }))
        expect(doc.queryEntities.ofTypes('noteTrack').get()).toHaveLength(2)
        expect(doc.queryEntities.ofTypes('tonematrix').get().map(entity => entity.fields.displayName.value)).toEqual(expect.arrayContaining(['Melody — Keyboard / channel 1', 'Harmony — Keyboard / channel 1']))
    })
    it('closes held notes at capture time and rejects empty/invalid takes', () => {
        expect(captureAudioToolTake([command('noteOn', 1)], 120, 1.5).notes[0].durationTicks).toBe(3840)
        expect(() => captureAudioToolTake([], 120, 1)).toThrow('Play or record')
        expect(() => captureAudioToolTake([command('noteOn', 1)], NaN, 2)).toThrow('tempo')
    })
})

describe('AudioTool document writes (real Nexus validator)', () => {
    it('creates a playable graph with tempo, separate channels and full note tails', async () => {
        const doc = await offline()
        const recording = captureAudioToolTake([command('noteOn', 1), command('noteOn', 1.2, 2), command('noteOff', 2), command('noteOff', 3, 2)], 100, 3)
        await doc.modify(t => appendAudioToolTake(t, recording, { placement: 'start', setTempo: true }))
        expect(doc.queryEntities.ofTypes('config').get()[0].fields.tempoBpm.value).toBe(100)
        expect(doc.queryEntities.ofTypes('noteTrack').get()).toHaveLength(2)
        expect(doc.queryEntities.ofTypes('desktopAudioCable').get()).toHaveLength(2)
        expect(doc.queryEntities.ofTypes('mixerMaster').get()).toHaveLength(1)
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(2)
        expect(doc.queryEntities.ofTypes('noteRegion').get()[0].fields.region.fields.durationTicks.value).toBe(12800)
    })
    it('appends to an existing instrument without deleting music or changing its tempo', async () => {
        const doc = await offline()
        await doc.modify(t => appendAudioToolTake(t, take(), { placement: 'start', setTempo: true }))
        const before = new Set(doc.queryEntities.get().map(entity => entity.id))
        const trackId = doc.queryEntities.ofTypes('noteTrack').get()[0].id
        const next = { ...take(), bpm: 90 }
        await doc.modify(t => appendAudioToolTake(t, next, { trackId, placement: 'end' }))
        expect(doc.queryEntities.ofTypes('noteTrack').get()).toHaveLength(1)
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(2)
        expect(doc.queryEntities.ofTypes('config').get()[0].fields.tempoBpm.value).toBe(120)
        expect(doc.queryEntities.ofTypes('noteRegion').get().map(region => region.fields.region.fields.positionTicks.value).sort((a, b) => a - b)).toEqual([0, 3840])
        for (const id of before) expect(doc.queryEntities.get().some(entity => entity.id === id)).toBe(true)
    })
    it('rejects a deleted destination before writing anything', async () => {
        const doc = await offline()
        await expect(doc.modify(t => appendAudioToolTake(t, take(), { trackId: 'missing', placement: 'start' }))).rejects.toThrow('no longer exists')
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(0)
    })
    it('orders new channels after existing delay and reverb strips', async () => {
        const doc = await offline()
        await doc.modify(t => {
            t.create('mixerDelayAux', { displayParameters: { orderAmongStrips: 3 } })
            t.create('mixerReverbAux', { displayParameters: { orderAmongStrips: 4 } })
        })
        await doc.modify(t => appendAudioToolTake(t, take(), { placement: 'end' }))
        expect(doc.queryEntities.ofTypes('mixerChannel').get()[0].fields.displayParameters.fields.orderAmongStrips.value).toBe(5)
    })
})

describe('AudioTool connection lifecycle', () => {
    it('loads the installed SDK with popup authentication available', async () => {
        const service = new AudioToolConnection()
        await expect(service.prepare()).resolves.toBeUndefined()
    })
    it('rejects an obsolete cached SDK without throwing out of the click handler', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://example.com' } })
        const service = new AudioToolConnection()
        Object.assign(service, { sdk: { createAudiotoolClient: vi.fn() } })
        let result: Promise<string> | undefined
        expect(() => { result = service.connect() }).not.toThrow()
        await expect(result).rejects.toThrow('outdated AudioTool module')
        await expect(service.prepare()).rejects.toThrow('outdated AudioTool module')
    })
    it('turns synchronous popup errors into a rejected promise', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://example.com' } })
        const service = new AudioToolConnection()
        Object.assign(service, { sdk: { audiotoolPopup: () => { throw new Error('popup failed') } } })
        let result: Promise<string> | undefined
        expect(() => { result = service.connect() }).not.toThrow()
        await expect(result).rejects.toThrow('popup failed')
    })
    it('opens OAuth synchronously from the user gesture and permits retry after cancellation', async () => {
        vi.stubGlobal('window', { location: { origin: 'https://example.com' } })
        const service = new AudioToolConnection()
        const audiotoolPopup = vi.fn().mockResolvedValueOnce({ status: 'unauthenticated', error: new Error('cancelled') }).mockResolvedValueOnce({ status: 'authenticated', userName: 'musician' })
        Object.assign(service, { sdk: { audiotoolPopup } })
        const login = service.connect()
        expect(audiotoolPopup).toHaveBeenCalledTimes(1)
        await expect(login).rejects.toThrow('cancelled')
        expect(service.isConnected).toBe(false)
        expect(await service.connect()).toBe('musician')
        service.disconnect()
        expect(service.isConnected).toBe(false)
    })
    it('validates a personal token before connecting and never persists it', async () => {
        const storage = { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() }
        const service = new AudioToolConnection(storage)
        const listProjects = vi.fn().mockResolvedValueOnce(new Error('invalid token')).mockResolvedValueOnce({ projects: [] })
        const createAudiotoolClient = vi.fn().mockResolvedValue({ projects: { listProjects } })
        Object.assign(service, { sdk: { createAudiotoolClient } })
        await expect(service.connectWithToken('bad')).rejects.toThrow('invalid token')
        expect(service.isConnected).toBe(false)
        await service.connectWithToken('valid')
        expect(service.isConnected).toBe(true)
        expect(storage.setItem).not.toHaveBeenCalled()
    })
    async function fixture() {
        const doc = await offline()
        const stop = vi.fn().mockResolvedValue(undefined)
        const synced = { ...doc, start: vi.fn().mockResolvedValue(undefined), stop, dawUrl: 'https://beta.audiotool.com/studio?project=test' }
        const service = new AudioToolConnection()
        const client = { open: vi.fn().mockResolvedValue(synced) }
        // Keep the real validator and transaction machinery; stub only network/auth.
        Object.assign(service, { client })
        return { service, doc, stop, synced, client }
    }
    it('flushes writes and recognises the same take on retry', async () => {
        const { service, doc, stop } = await fixture()
        expect((await service.sendTake('projects/test', take(), { placement: 'end', setTempo: true })).alreadySent).toBe(false)
        expect((await service.sendTake('projects/test', take(), { placement: 'end' })).alreadySent).toBe(true)
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(1)
        expect(stop).toHaveBeenCalledTimes(2)
    })
    it('releases the transaction after rejecting a deleted track so a corrected send can finish', async () => {
        const { service, doc } = await fixture()
        await expect(service.sendTake('projects/test', take(), { trackId: 'deleted', placement: 'end' })).rejects.toThrow('no longer exists')
        await expect(service.sendTake('projects/test', take(), { placement: 'end' })).resolves.toMatchObject({ noteCount: 1 })
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(1)
    })
    it('rejects invalid notes before opening or changing the project', async () => {
        const { service, client } = await fixture()
        const invalid = take()
        invalid.notes[0].pitch = 128
        await expect(service.sendTake('projects/test', invalid, { placement: 'end' })).rejects.toThrow('invalid note')
        expect(client.open).not.toHaveBeenCalled()
    })
    it('retains retry protection when flushing fails and still stops after write errors', async () => {
        const { service, doc, stop } = await fixture()
        stop.mockRejectedValueOnce(new Error('network lost'))
        await expect(service.sendTake('projects/test', take(), { placement: 'end', setTempo: true })).rejects.toThrow('network lost')
        expect((await service.sendTake('projects/test', take(), { placement: 'end' })).alreadySent).toBe(true)
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(1)
        await expect(service.sendTake('projects/test', take(), { trackId: 'deleted', placement: 'end' })).rejects.toThrow('no longer exists')
        expect(stop).toHaveBeenCalledTimes(3)
    })
    it('handles SDK Error responses and paginates projects', async () => {
        const service = new AudioToolConnection()
        const listProjects = vi.fn().mockResolvedValueOnce({ projects: [{ name: 'projects/a', displayName: 'A' }], nextPageToken: 'page2' }).mockResolvedValueOnce({ projects: [{ name: 'projects/b', displayName: 'B' }], nextPageToken: '' }).mockResolvedValueOnce(new Error('access denied'))
        Object.assign(service, { client: { projects: { listProjects } } })
        expect(await service.listProjects()).toHaveLength(2)
        expect(listProjects.mock.calls[1][0].pageToken).toBe('page2')
        await expect(service.listProjects()).rejects.toThrow('access denied')
    })
    it('cleans up failed starts and refuses offline writes', async () => {
        const { service, synced, stop, doc } = await fixture()
        synced.start.mockRejectedValueOnce(new Error('cannot connect'))
        await expect(service.inspectProject('projects/test')).rejects.toThrow('cannot connect')
        expect(stop).toHaveBeenCalledTimes(1)
        synced.connected.setValue(false)
        await expect(service.sendTake('projects/test', take(), { placement: 'end' })).rejects.toThrow('offline')
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(0)
        expect(stop).toHaveBeenCalledTimes(2)
    })
    it('prevents concurrent sends and checks persisted region IDs after reconnecting', async () => {
        const { service, client, doc } = await fixture()
        const values = new Map<string, string>()
        const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
        Object.assign(service, { storage })
        const first = service.sendTake('projects/test', take(), { placement: 'end', setTempo: true })
        await expect(service.sendTake('projects/test', take(), { placement: 'end' })).rejects.toThrow('already being sent')
        await first
        const reconnected = new AudioToolConnection(storage)
        Object.assign(reconnected, { client })
        expect((await reconnected.sendTake('projects/test', take(), { placement: 'end' })).alreadySent).toBe(true)
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(1)
    })
})
