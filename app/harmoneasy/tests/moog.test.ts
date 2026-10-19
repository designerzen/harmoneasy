// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import registerMoogProcessor from '../../../packages/audiobus/wam/moog/processor.js'
import { MOOG_ID, MOOG_PARAMETERS } from '../../../packages/audiobus/wam/moog/parameters'
import { createMoogGui, destroyMoogGui } from '../../../packages/audiobus/wam/moog/gui'
import { WAM_AUTOMATION_EVENT, WAM_MIDI_EVENT } from '../../../packages/audiobus/wam/host'
import { createOutputById } from '../../../packages/audiobus/io/output-factory'

afterEach(() => vi.unstubAllGlobals())

function processor(rate = 48000, parameters: Record<string, number> = {}) {
    let Processor: any
    vi.stubGlobal('sampleRate', rate)
    vi.stubGlobal('webAudioModules', { getModuleScope: () => ({
        WamProcessor: class {},
        WamParameterInfo: class { constructor(id: string, config: object) { Object.assign(this, { id }, config) } },
    }) })
    vi.stubGlobal('registerProcessor', (id: string, ctor: any) => { expect(id).toBe(MOOG_ID); Processor = ctor })
    // The SDK stringifies the function and runs it in an isolated worklet scope.
    const register = new Function(`return (${registerMoogProcessor.toString()})`)()
    register(MOOG_ID, MOOG_PARAMETERS)
    const node = new Processor({})
    node._parameterInterpolators = Object.fromEntries(Object.entries(MOOG_PARAMETERS).map(([id, config]) => [id,
        { values: new Float32Array(128).fill(parameters[id] ?? config.defaultValue) },
    ]))
    return node
}
function render(node: any, blocks = 1) {
    const result: number[] = []
    for (let block = 0; block < blocks; block++) {
        const channels = [new Float32Array(128), new Float32Array(128)]
        node._process(0, 128, [], [channels])
        expect(channels[0]).toEqual(channels[1])
        result.push(...channels[0])
    }
    return result
}
const rms = (samples: number[]) => Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length)

describe('Moog WAM processor', () => {
    it('is silent until a note arrives and releases back to silence', () => {
        const node = processor(48000, { release: 0.005 })
        expect(rms(render(node))).toBe(0)
        node._onMidi({ bytes: [0x90, 69, 110] })
        expect(rms(render(node, 10))).toBeGreaterThan(0.005)
        node._onMidi({ bytes: [0x90, 69, 0] })
        render(node, 12)
        expect(rms(render(node))).toBe(0)
        expect(node.voices).toHaveLength(0)
    })
    it('attenuates high frequencies when the ladder cutoff is lowered', () => {
        const amplitude = (frequency: number) => {
            const node = processor(48000, { frequency, waveform: 3, gain: 0 })
            node._onMidi({ bytes: [0x90, 93, 127] })
            render(node, 20)
            return rms(render(node, 10))
        }
        expect(amplitude(200)).toBeLessThan(amplitude(10000) / 20)
    })
    it.each([22050, 44100, 48000, 96000])('stays finite at parameter extremes at %i Hz', rate => {
        const node = processor(rate, { frequency: 20000, gain: 4, volume: 1 })
        for (let note = 60; note < 80; note++) node._onMidi({ bytes: [0x90, note, 127] })
        expect(node.voices).toHaveLength(16)
        const audio = render(node, 50)
        expect(audio.every(s => Number.isFinite(s) && Math.abs(s) <= 1)).toBe(true)
        expect(rms(audio)).toBeGreaterThan(0)
    })
    it('honours channel sustain, pitch bend and channel-specific panic', () => {
        const node = processor()
        node._onMidi({ bytes: [0x91, 60, 127] })
        node._onMidi({ bytes: [0x92, 60, 127] })
        node._onMidi({ bytes: [0xb1, 64, 127] })
        node._onMidi({ bytes: [0x81, 60, 0] })
        expect(node.voices[0].released).toBe(false)
        node._onMidi({ bytes: [0xe1, 127, 127] })
        expect(node.bend[1]).toBeGreaterThan(1.99)
        node._onMidi({ bytes: [0xb1, 64, 0] })
        expect(node.voices[0].released).toBe(true)
        node._onMidi({ bytes: [0xb1, 120, 0] })
        expect(node.voices.map((v: any) => v.channel)).toEqual([2])
    })
    it('only writes the samples in the WAM event slice', () => {
        const node = processor()
        const channel = new Float32Array(128).fill(0.5)
        node._process(16, 32, [], [[channel]])
        expect(channel[15]).toBe(0.5)
        expect(channel[16]).toBe(0)
        expect(channel[31]).toBe(0)
        expect(channel[32]).toBe(0.5)
    })
})

describe('Moog GUI and output', () => {
    it('schedules automation, reflects host changes and cleans up GUI listeners', async () => {
        const node = Object.assign(new EventTarget(), {
            context: { currentTime: 2 }, getParameterValues: async () => ({}), scheduleEvents: vi.fn(),
        })
        const remove = vi.spyOn(node, 'removeEventListener')
        const gui = await createMoogGui(node)
        const cutoff = gui.shadowRoot!.querySelector<HTMLInputElement>('[aria-label="Cutoff"]')!
        cutoff.value = '1'
        cutoff.dispatchEvent(new Event('input'))
        expect(node.scheduleEvents).toHaveBeenCalledWith({ type: WAM_AUTOMATION_EVENT, time: 2,
            data: { id: 'frequency', value: 20000, normalized: false } })
        node.dispatchEvent(new CustomEvent(WAM_AUTOMATION_EVENT, { detail: { data: { id: 'frequency', value: 20 } } }))
        expect(cutoff.value).toBe('0')
        node.dispatchEvent(new CustomEvent(WAM_AUTOMATION_EVENT, { detail: { data: { id: 'frequency', value: 1, normalized: true } } }))
        expect(cutoff.value).toBe('1')
        gui.shadowRoot!.querySelector('button')!.click()
        expect(node.scheduleEvents).toHaveBeenCalledWith({ type: WAM_MIDI_EVENT, time: 2, data: { bytes: [0xbf, 120, 0] } })
        destroyMoogGui(gui)
        expect(remove).toHaveBeenCalledWith(WAM_AUTOMATION_EVENT, expect.any(Function))
    })
    it('creates an output routed to the mixer and forwards MIDI through the WAM node', async () => {
        vi.stubGlobal('AudioWorklet', class {})
        const gain = { connect: vi.fn(), disconnect: vi.fn() }
        const mixer = {} as AudioNode
        const context = { createGain: () => gain, currentTime: 3, destination: {} } as unknown as AudioContext
        const output = await createOutputById('moog', { audioContext: context, mixer })
        const audioNode = { connect: vi.fn(), disconnect: vi.fn(), destroy: vi.fn(), scheduleEvents: vi.fn() }
        vi.spyOn(output as any, 'createPlugin').mockResolvedValue({ audioNode, descriptor: { name: 'Moog' } })
        await output.connect!()
        expect(gain.connect).toHaveBeenCalledWith(mixer)
        output.noteOn(60, 100)
        expect(audioNode.scheduleEvents).toHaveBeenCalledWith({ type: WAM_MIDI_EVENT, time: 3, data: { bytes: [0x90, 60, 100] } })
        await output.disconnect!()
        expect(audioNode.destroy).toHaveBeenCalledOnce()
    })
})
