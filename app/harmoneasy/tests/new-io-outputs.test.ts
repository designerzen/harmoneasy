// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutputSamplePlayer from '../../../packages/audiobus/io/outputs/output-sample-player'
import OutputEventRecorder from '../../../packages/audiobus/io/outputs/output-event-recorder'
import OutputNoteMonitor from '../../../packages/audiobus/io/outputs/output-note-monitor'
import OutputOnscreenKeyboard from '../../../packages/audiobus/io/outputs/output-onscreen-keyboard'
import OutputManager from '../../../packages/audiobus/io/output-manager'
import { deviceDefinition, defineDevice } from '../../../packages/audiobus/io/device-definition'
import { musicalCommand, parseEventClip } from '../../../packages/audiobus/io/event-clip'
import { NOTE_OFF, NOTE_ON, CONTROL_CHANGE } from '../../../packages/audiobus/commands'

const outputs: Array<{ destroy(): void }> = []
afterEach(() => { outputs.splice(0).forEach(output => output.destroy()); vi.restoreAllMocks() })
const command = (type: string, number = 60, channel = 1) => musicalCommand({ type, number, channel, velocity: type === NOTE_ON ? 100 : 0 })

function audioContext() {
    const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() })
    const createGain = vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() }))
    const createBufferSource = vi.fn(() => ({ buffer: null, loop: false, playbackRate: param(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn() }))
    return Object.assign(Object.create({}), { currentTime: 10, destination: {}, createGain, createBufferSource, resume: vi.fn(async () => {}),
        decodeAudioData: vi.fn(async () => ({ duration: 1, length: 44100 })) })
}

describe('sample player output', () => {
    it('persists sample data and plays transposed, velocity-scaled voices per channel', async () => {
        const context = audioContext()
        const output = defineDevice(new OutputSamplePlayer({ audioContext: context, root: 60 }), { factory: 'output', type: 'sample-player' })
        outputs.push(output)
        await output.loadSample(new Uint8Array([1, 2, 3]).buffer, 'sample.wav')
        const saved = JSON.parse(JSON.stringify(deviceDefinition(output)))
        expect(saved.options.sample).toBe('AQID'); expect(saved.options.audioContext).toBeUndefined()
        await output.sendCommand(command(NOTE_ON, 72, 2)); await output.sendCommand(command(NOTE_ON, 72, 3))
        const sources = context.createBufferSource.mock.results.map(result => result.value)
        expect(sources[0].playbackRate.value).toBe(2)
        expect(context.createGain.mock.results[1].value.gain.linearRampToValueAtTime).toHaveBeenCalledWith(100 / 127, 10.005)
        await output.sendCommand(command(NOTE_OFF, 72, 2))
        expect(sources[0].stop).toHaveBeenCalledOnce(); expect(sources[1].stop).not.toHaveBeenCalled()
        output.allNotesOff(); expect(sources[1].stop).toHaveBeenCalledOnce()
    })
    it('cancels a pending decoded note after panic and does not let an old decode replace a new sample', async () => {
        const context = audioContext(); let decode!: (value: any) => void
        context.decodeAudioData.mockImplementationOnce(() => new Promise(resolve => { decode = resolve }))
        const output = new OutputSamplePlayer({ audioContext: context, sample: 'AQID' }); outputs.push(output)
        const pending = output.noteOn(60, 100)
        output.allNotesOff()
        await output.loadSample(new Uint8Array([4, 5, 6]).buffer, 'new.wav')
        decode({ duration: 2, length: 88200 }); await pending
        expect(context.createBufferSource).not.toHaveBeenCalled()
        await output.noteOn(60, 100)
        expect(context.createBufferSource.mock.results[0].value.buffer).toEqual({ duration: 1, length: 44100 })
    })
    it('limits polyphony and rejects oversized samples before decoding', async () => {
        const context = audioContext(), output = new OutputSamplePlayer({ audioContext: context }); outputs.push(output)
        await expect(output.loadSample(new ArrayBuffer(4 * 1024 * 1024 + 1), 'big.wav')).rejects.toThrow('4 MB')
        expect(context.decodeAudioData).not.toHaveBeenCalled()
        await output.loadSample(new Uint8Array([1]).buffer, 'small.wav')
        for (let note = 0; note < 33; note++) await output.noteOn(note, 100)
        expect(context.createBufferSource.mock.results[0].value.stop).toHaveBeenCalledOnce()
    })
    it('routes through the host mixer and cleans up on disconnect', async () => {
        const context = audioContext(), mixer = {}
        const output = new OutputSamplePlayer({ audioContext: context, mixer }); outputs.push(output)
        expect(context.createGain.mock.results[0].value.connect).toHaveBeenCalledWith(mixer)
        await output.disconnect(); expect(output.isConnected).toBe(false)
        await output.connect(); expect(output.isConnected).toBe(true)
    })
})

describe('event recorder output', () => {
    it('captures channel data and closes held notes and sustain in the exported clip', () => {
        let now = 10
        const output = new OutputEventRecorder({ now: () => now }); outputs.push(output)
        output.sendCommand(command(NOTE_ON)); expect(output.options.commands).toHaveLength(0)
        output.startRecording(); output.sendCommand(command(NOTE_ON, 65, 3))
        output.sendCommand({ ...command(CONTROL_CHANGE, 64, 3), value: 127 })
        now = 11; output.stopRecording()
        const clip = parseEventClip({ version: 1, ...output.options })
        expect(clip.duration).toBe(1)
        expect(clip.commands.map(event => [event.type, event.number, event.channel, event.startAt])).toEqual([
            [NOTE_ON, 65, 3, 0], [CONTROL_CHANGE, 64, 3, 0], [NOTE_OFF, 65, 3, 1], [CONTROL_CHANGE, 64, 3, 1],
        ])
        expect(clip.commands.at(-1)?.value).toBe(0)
    })
    it('records equal pitches on separate channels through OutputManager and stops with transport', async () => {
        let now = 0
        const output = new OutputEventRecorder({ now: () => now }); outputs.push(output)
        const manager = new OutputManager(); manager.add(output); output.startRecording()
        await manager.triggerAudioCommandsOnOutputs([command(NOTE_ON, 60, 1), command(NOTE_ON, 60, 2)])
        expect(output.options.commands).toHaveLength(2)
        now = 1; output.stopClock(); manager.destroy(); await OutputManager.settled(output)
        expect(output.options.commands.filter((event: any) => event.type === NOTE_OFF)).toHaveLength(2)
    })
})

describe('visual note outputs', () => {
    it('clears only the display notes it owns and handles overlapping releases', () => {
        const keyboard = { setKeyAsActive: vi.fn(), setKeyAsInactive: vi.fn(), destroy: vi.fn() }
        const output = new OutputOnscreenKeyboard(keyboard as any); outputs.push(output)
        output.noteOn(60, 100); output.noteOn(60, 100); output.noteOff(60)
        expect(keyboard.setKeyAsInactive).not.toHaveBeenCalled()
        output.noteOn(64, 100); output.allNotesOff()
        expect(keyboard.setKeyAsInactive.mock.calls).toEqual([[60], [64]])
        output.destroy(); expect(keyboard.destroy).not.toHaveBeenCalled()
    })
    it('shows independent channels and closes all active note durations on panic', async () => {
        let now = 10
        const output = new OutputNoteMonitor({ now: () => now }); outputs.push(output)
        const panel = await output.createGui()
        output.sendCommand(command(NOTE_ON, 60, 2)); output.sendCommand(command(NOTE_ON, 60, 3))
        expect(panel.querySelector('p')?.textContent).toContain('channel 2')
        output.sendCommand(command(NOTE_OFF, 60, 2))
        expect(panel.querySelector('p')?.textContent).not.toContain('channel 2')
        now = 10.5; output.allNotesOff()
        expect(panel.querySelector('p')?.textContent).toBe('No held notes')
        expect(panel.querySelector('svg title')?.textContent).toContain('0.00 s')
        await output.destroyGui(); expect(await output.createGui()).not.toBe(panel)
    })
})
