// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CLAP_PATCHES } from '../../../packages/audiobus/instruments/clap/clap-catalog'
import { createCLAPNode } from '../../../packages/audiobus/instruments/clap/clap-host'
import { openCLAPInterface } from '../../../packages/audiobus/instruments/clap/clap-ui'
import { connectCLAPMixer, insertCLAPEffect } from '../../../packages/audiobus/instruments/clap/clap-mixer'
import { createOutputById, getAvailableOutputFactories } from '../../../packages/audiobus/io/output-factory'
import { webclapOutputId } from '../../../packages/audiobus/io/outputs/output-types'
import { OUTPUT_DEFINITIONS } from '../../../packages/audiobus/io/output-definitions'
import { deviceDefinition } from '../../../packages/audiobus/io/device-definition'
import { CONTROL_CHANGE, PITCH_BEND, NOTE_ON } from '../../../packages/audiobus/commands'
import CLAPInstrument from '../../../packages/audiobus/instruments/clap/clap-instrument'

vi.mock('../../../packages/audiobus/instruments/clap/clap-host', async importOriginal => ({
    ...await importOriginal<any>(), createCLAPNode: vi.fn(),
}))
vi.mock('../../../packages/audiobus/instruments/clap/clap-ui', () => ({ openCLAPInterface: vi.fn() }))

function audioNode() {
    const connections = new Set<any>()
    return { connections, connect: vi.fn((node: any) => { connections.add(node); return node }),
        disconnect: vi.fn((node?: any) => node ? connections.delete(node) : connections.clear()) } as any
}
let nodes: any[]
let context: any, mixer: any, master: any
beforeEach(() => {
    nodes = []
    master = audioNode(); mixer = audioNode()
    context = { createGain: audioNode, destination: master }
    connectCLAPMixer(mixer, master)
    vi.stubGlobal('AudioWorkletNode', class {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ patches: CLAP_PATCHES }) }))
    vi.mocked(createCLAPNode).mockImplementation(async (_context, _url, id) => {
        const patch = CLAP_PATCHES.find(patch => patch.id === id)!
        const node = { ...audioNode(), descriptor: { name: patch.name, features: patch.features },
            events: {}, port: { close: vi.fn() }, destroy: vi.fn().mockResolvedValue(undefined),
            sendMidi: vi.fn().mockResolvedValue(undefined),
            getParams: vi.fn().mockResolvedValue([{ id: 1, name: 'Gain', min: 0, max: 1, default: 0.5, flags: {}, value: { value: 0.5, text: '50%' } }]),
            setParam: vi.fn().mockImplementation(async (_id: number, value: number) => ({ value, text: `${value}` })),
            openInterface: vi.fn(),
        }
        nodes.push(node)
        return node
    })
    vi.mocked(openCLAPInterface).mockImplementation(async node => {
        const frame = document.createElement('iframe')
        frame.title = node.descriptor.name
        return { frame, close: vi.fn(() => frame.remove()) }
    })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('excludes WebCLAP effects and processors from output definitions and factories', () => {
    const factories = getAvailableOutputFactories()
    for (const patch of CLAP_PATCHES.filter(patch => !patch.features?.includes('instrument'))) {
        const id = webclapOutputId(patch.id)
        expect(OUTPUT_DEFINITIONS[id]).toBeUndefined()
        expect(factories.some(factory => factory.id === id)).toBe(false)
    }
})

it.each(CLAP_PATCHES.filter(patch => patch.features?.includes('instrument')))('adds and mounts controls for $name with the correct audio route', async patch => {
    const id = webclapOutputId(patch.id)
    expect(getAvailableOutputFactories().some(factory => factory.id === id)).toBe(true)
    const output = await createOutputById(id, { audioContext: context, mixer })
    expect(output.isConnected).toBe(true)
    expect(createCLAPNode).toHaveBeenCalledWith(context, patch.url, patch.factory)
    const gui = await output.createGui!()
    document.body.append(gui)
    expect(gui.textContent).not.toContain('could not load')
    expect(gui.querySelector('iframe')?.title).toBe(patch.name)
    expect(output.requiresConnectionControl).toBe(false)
    expect(gui.querySelector('select')).toBeNull()
    expect(gui.firstElementChild).toBe(gui.querySelector('iframe'))
    expect(gui.children[1]).toBe(gui.querySelector('.webclap-parameters'))
    expect(gui.querySelector('input[aria-label="Gain"]')).not.toBeNull()
    expect(gui.querySelector('h3')).toBeNull()
    expect(gui.textContent).not.toContain(patch.description)
    expect(gui.querySelector('[aria-label="Plugin classification"]')).toBeNull()
    expect(gui.querySelector('[role="status"]')).toBeNull()
    const credits = gui.querySelector('.webclap-attribution')!
    expect(credits.querySelector('summary')?.textContent).toBe('Attribution & licenses')
    expect(credits.textContent).toContain(patch.attribution!.author)
    expect(credits.querySelector('a')?.getAttribute('href')).toBe(patch.attribution!.sourceUrl)
    for (const license of patch.attribution!.licenseUrls) expect(credits.querySelector(`a[href="${license}"]`)).not.toBeNull()
    const factory = getAvailableOutputFactories().find(factory => factory.id === id)!
    expect([factory.title, factory.category, factory.type, factory.subtype]).toEqual([patch.title, patch.category, patch.type, patch.subtype])
    if (patch.features?.includes('instrument')) {
        expect(nodes[0].connections.has(output.output)).toBe(true)
        expect((output.output as any).connections.has(mixer)).toBe(true)
    } else {
        expect(mixer.connections.has(nodes[0])).toBe(true)
        expect(nodes[0].connections.has(master)).toBe(true)
        expect(mixer.connections.has(master)).toBe(false)
    }
    const slider = gui.querySelector('input')!
    slider.value = '0.7'; slider.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(deviceDefinition(output).options?.parameters).toEqual({ 1: 0.7 }))
    await output.destroyGui!()
    expect(output.isConnected).toBe(true)
    await output.disconnect!()
    expect(nodes[0].destroy).toHaveBeenCalledOnce()
    expect(nodes[0].port.close).toHaveBeenCalledOnce()
    expect(mixer.connections.has(master)).toBe(true)
})

it('preserves MIDI channels, CC and pitch bend and releases held notes before disconnect', async () => {
    const output = await createOutputById(webclapOutputId('com.plinken.organ'), { audioContext: context, mixer }) as CLAPInstrument
    for (const command of [
        { type: NOTE_ON, number: 64, velocity: 90, channel: 4 },
        { type: CONTROL_CHANGE, number: 64, value: 127, channel: 4 },
        { type: PITCH_BEND, value: 10000, channel: 4 },
    ]) await output.sendCommand(command as any)
    expect(nodes[0].sendMidi.mock.calls.slice(0, 3).map((call: any) => call[0])).toEqual([[0x93, 64, 90], [0xb3, 64, 127], [0xe3, 16, 78]])
    expect(output.getNoteKey({ channel: 4, number: 64 } as any)).not.toBe(output.getNoteKey({ channel: 5, number: 64 } as any))
    await output.disconnect()
    expect(nodes[0].sendMidi).toHaveBeenCalledWith([0x83, 64, 0])
    expect(nodes[0].sendMidi).toHaveBeenCalledWith([0xb3, 64, 0])
})

it('keeps analyser taps and other effects when removing an insert', () => {
    const a = audioNode(), b = audioNode(), analyser = audioNode()
    mixer.connect(analyser)
    const removeA = insertCLAPEffect(mixer, a), removeB = insertCLAPEffect(mixer, b)
    expect([...mixer.connections]).toEqual([analyser, a])
    expect([...a.connections]).toEqual([b])
    removeA()
    expect([...mixer.connections]).toEqual([analyser, b])
    removeB(); removeB()
    expect([...mixer.connections]).toEqual([analyser, master])
})

it('keeps controls usable when a native interface cannot open', async () => {
    vi.mocked(openCLAPInterface).mockRejectedValueOnce(new Error('No service worker'))
    const output = await createOutputById(webclapOutputId('com.plinken.piano'), { audioContext: context, mixer })
    const gui = await output.createGui!()
    expect(gui.querySelector('[data-clap-parameters]')?.parentElement?.hasAttribute('open')).toBe(true)
    expect(gui.textContent).toContain('use parameters')
    await output.disconnect!()
})

it('does not revive a plugin disconnected during loading', async () => {
    const output = new CLAPInstrument(context, 'com.plinken.organ', { mixer })
    const create = vi.mocked(createCLAPNode).getMockImplementation()!
    let resolve!: (value: any) => void
    vi.mocked(createCLAPNode).mockImplementationOnce(() => new Promise(pass => { resolve = pass }))
    const connecting = output.connect()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await output.disconnect()
    const node = await create(context, '', 'com.plinken.organ')
    resolve(node)
    await connecting
    expect(output.isConnected).toBe(false)
    expect(node.destroy).toHaveBeenCalledOnce()
})
