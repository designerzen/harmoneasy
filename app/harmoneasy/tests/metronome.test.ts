import { describe, expect, it, vi } from 'vitest'
import OutputMetronome from '../../../packages/audiobus/io/outputs/output-metronome'

function setup() {
    const oscillators: any[] = []
    const gains: any[] = []
    const context = {
        currentTime: 10,
        destination: {},
        createGain() {
            const node = { connect: vi.fn(), disconnect: vi.fn(), gain: {
                value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn()
            } }
            gains.push(node)
            return node
        },
        createOscillator() {
            const node = { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(),
                start: vi.fn(), stop: vi.fn(), onended: () => {} }
            oscillators.push(node)
            return node
        }
    }
    return { output: new OutputMetronome(context as unknown as AudioContext), oscillators, gains }
}

describe('metronome output', () => {
    it('uses transport position for the downbeat even when enabled mid-bar or rewound', () => {
        const { output, oscillators } = setup()
        for (const beat of [2, 3, 4, 5, 0]) output.playBeat(beat)
        expect(oscillators.map(node => node.frequency.value)).toEqual([800, 800, 1200, 800, 1200])
    })

    it('supports different measure lengths and the existing note output', () => {
        const { output, oscillators } = setup()
        output.playBeat(2, 3)
        output.noteOn()
        output.noteOn()
        expect(oscillators.map(node => node.frequency.value)).toEqual([800, 1200, 800])
    })

    it('schedules audio against the context clock and disconnects completed clicks', () => {
        const { output, oscillators, gains } = setup()
        output.playBeat(0, 4, 12)
        expect(oscillators[0].start).toHaveBeenCalledWith(12)
        expect(oscillators[0].stop).toHaveBeenCalledWith(12.05)
        oscillators[0].onended()
        expect(oscillators[0].disconnect).toHaveBeenCalledOnce()
        expect(gains[1].disconnect).toHaveBeenCalledOnce()
        output.playBeat(1, 4, 9)
        expect(oscillators[1].start).toHaveBeenCalledWith(10)
    })
})
