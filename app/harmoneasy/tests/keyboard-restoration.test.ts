import { describe, expect, it, vi } from 'vitest'
import InputOnScreenKeyboard from '../../../packages/audiobus/io/inputs/input-onscreen-keyboard'
import NoteModel from '../../../packages/audiobus/note-model'
import { defineDevice, deviceDefinition } from '../../../packages/audiobus/io/device-definition'
import { restoreDevice } from '../../../packages/audiobus/io/workspace-devices'
import InputKeyboard from '../../../packages/audiobus/io/inputs/input-keyboard'
import OutputManager from '../../../packages/audiobus/io/output-manager'
import { NOTE_ON, NOTE_OFF } from '../../../packages/audiobus/commands'

vi.mock('../../../packages/audiobus/hardware/keyboard/keyboard', () => ({ addKeyboardDownEvents: () => () => {} }))

// Exercise persistence without requiring a browser DOM for the keyboard view.
vi.mock('../../../packages/audiobus/ui/keyboard-svg.ts', () => ({
    default: class {
        constructor(readonly notes: any[]) {
            notes.forEach(note => { if (typeof note.accidental !== 'boolean') throw new Error('Invalid key') })
        }
    }
}))

const options = { outputMixer: {} as GainNode, now: () => 0 }

describe('onscreen keyboard restoration', () => {
    it.each([[0.5, 64], [1, 127], [0, 0]])('converts pressure %s to MIDI velocity %s', async (pressure, velocity) => {
        const input = new InputOnScreenKeyboard()
        const manager = new OutputManager()
        const output = { noteOn: vi.fn(), noteOff: vi.fn() } as any
        manager.add(output)
        const dispatch = vi.spyOn(input, 'dispatch')
        input.onKeyDown(60, pressure)
        const command = dispatch.mock.calls[0][0]
        expect(command.velocity).toBe(velocity)
        await manager.triggerAudioCommandsOnOutputs([command])
        if (velocity) expect(output.noteOn).toHaveBeenCalledWith(60, velocity)
        else expect(output.noteOn).not.toHaveBeenCalled()
    })

    it('sends audible notes and releases from the computer keyboard', async () => {
        const input = new InputKeyboard()
        const manager = new OutputManager()
        const output = { noteOn: vi.fn(), noteOff: vi.fn() } as any
        manager.add(output)
        const dispatch = vi.spyOn(input, 'dispatch')
        for (const type of [NOTE_ON, NOTE_OFF]) {
            (input as any).onKeyEvent(type, 'q', 60, {})
            await manager.triggerAudioCommandsOnOutputs([dispatch.mock.lastCall![0]])
        }
        expect(output.noteOn).toHaveBeenCalledWith(60, 127)
        expect(output.noteOff).toHaveBeenCalledWith(60)
    })

    it.each([undefined, [new NoteModel(60), new NoteModel(61)]])('preserves key data through JSON persistence', async keys => {
        const input = defineDevice(new InputOnScreenKeyboard(keys ? { keys } : undefined), { factory: 'keyboard-input' })
        const definition = JSON.parse(JSON.stringify(deviceDefinition(input)))
        expect(definition.options.keys).toHaveLength(keys?.length ?? 128)
        expect(definition.options.keys.every((key: any) => key !== null && typeof key.colour === 'string')).toBe(true)
        const restored = await restoreDevice({ id: 'keyboard', direction: 'input', definition }, options, new Map())
        expect(restored.options.keys).toEqual(input.options.keys)
        expect(restored.options.keys[1].accidental).toBe(true)
    })

    it.each([Array(128).fill(null), null, []])('recovers invalid saved keys and restores the dependent output', async keys => {
        const input = await restoreDevice({ id: 'keyboard', direction: 'input',
            definition: { factory: 'keyboard-input', options: { keys } } }, options, new Map())
        expect(input.options.keys.map((key: any) => key.noteNumber)).toEqual(Array.from({ length: 128 }, (_, i) => i))
        const output = await restoreDevice({ id: 'display', direction: 'output',
            definition: { factory: 'keyboard-output', inputId: 'keyboard' } }, options, new Map([['keyboard', input]]))
        expect(output.keyboard).toBe(input.keyboard)
        expect(output.isConnected).toBe(true)
        expect(deviceDefinition(input).options!.keys).toEqual(input.options.keys)
    })
})
