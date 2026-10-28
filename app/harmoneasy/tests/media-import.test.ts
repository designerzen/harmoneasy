import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMediaImporter } from '../source/services/media-import'

const factories = vi.hoisted(() => ({ input: vi.fn(), output: vi.fn(), midi: vi.fn(), store: vi.fn() }))
vi.mock('../../../packages/audiobus/io/input-factory', () => ({ createInputById: factories.input }))
vi.mock('../../../packages/audiobus/io/output-factory', () => ({ createOutputById: factories.output }))
vi.mock('../../../packages/audiobus/importers/import-midi-file', () => ({ importMIDIFile: factories.midi }))
vi.mock('../source/services/wam-archive', () => ({ storeWamArchive: factories.store }))
const chain = {}
let manager: any, score: ReturnType<typeof vi.fn>, output: any
beforeEach(() => {
    vi.resetAllMocks()
    output = { connect: vi.fn(), destroy: vi.fn() }
    factories.output.mockResolvedValue(output)
    factories.input.mockResolvedValue({ name: 'tune' })
    factories.midi.mockResolvedValue({ noteCount: 1, commands: [{ type: 'noteOn', startAt: 0, number: 60 }] })
    manager = { activeChain: chain, deviceOptions: { mixer: {} }, audioContext: { resume: vi.fn() }, addDevice: vi.fn() }
    score = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

it('loads hosted community entry points and descriptors as WAM2 outputs', async () => {
    const load = createMediaImporter(manager, score)
    await load('https://www.webaudiomodules.com/community/plugins/burns-audio/synth101/descriptor.json')
    expect(factories.output).toHaveBeenCalledWith('wam2', expect.objectContaining({ pluginUrl: 'https://www.webaudiomodules.com/community/plugins/burns-audio/synth101/index.js' }))
    expect(output.connect).toHaveBeenCalledOnce()
    expect(manager.addDevice).toHaveBeenCalledWith(chain, output, 'output')
})
it('uses the existing adapter for a supported legacy WAM', async () => {
    await createMediaImporter(manager, score)('legacy:dx7')
    expect(factories.output).toHaveBeenCalledWith('wam', expect.objectContaining({ pluginUrl: 'legacy:dx7' }))
})
it('adds MIDI as a saved input instead of scheduling it directly on the chain', async () => {
    await createMediaImporter(manager, score)(new File(['MThd0000'], 'song.mid'))
    expect(factories.input).toHaveBeenCalledWith('midi-file', expect.objectContaining({ fileName: 'song.mid', commands: [{ type: 'noteOn', startAt: 0, number: 60 }] }))
    expect(manager.addDevice).toHaveBeenCalledWith(chain, { name: 'tune' }, 'input')
    expect(score).not.toHaveBeenCalled()
})
it('cleans up a failed plugin and preserves existing score imports', async () => {
    output.connect.mockRejectedValue(new Error('Plugin failed'))
    const load = createMediaImporter(manager, score)
    await expect(load('https://example.com/index.js')).rejects.toThrow('Plugin failed')
    expect(output.destroy).toHaveBeenCalledOnce()
    expect(manager.addDevice).not.toHaveBeenCalled()
    const xml = new File(['<score/>'], 'song.musicxml')
    await load(xml)
    expect(score).toHaveBeenCalledWith(xml)
})
it('rejects misleading MIDI files and page links with useful errors', async () => {
    const load = createMediaImporter(manager, score)
    await expect(load(new File(['not MIDI'], 'song.mid'))).rejects.toThrow('Standard MIDI File header')
    await expect(load('https://example.com/community.html')).rejects.toThrow('documentation or gallery page')
})
