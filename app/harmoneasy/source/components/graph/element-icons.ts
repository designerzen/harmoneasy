import { deviceDefinition } from 'audiobus/io/device-definition'
import { getTransformerDefinition, getTransformerIcon } from 'audiobus/io/transformer-definitions'
import type { InputId } from 'audiobus/io/inputs/input-types'
import type { OutputId } from 'audiobus/io/outputs/output-types'
import { MIDI_DEVICE_PROFILES } from 'audiobus/midi/hardware/device-profiles'

export type ElementKind = 'input' | 'output' | 'instrument' | 'transformer'

export function elementDescription(kind: ElementKind, id: string, name: string, description?: string): string {
    return description?.trim() || (kind === 'transformer' ? getTransformerDefinition(id)?.description : undefined)
        || (kind === 'instrument' ? `Turn incoming notes into ${name} instrument audio.` : `Use ${name} as a ${kind} in this chain.`)
}

const INPUT_ICONS: Partial<Record<InputId, string>> = {
    keyboard: 'keyboard', gamepad: 'gamepad', 'gamepad-music': 'gamepad',
    webmidi: 'midi', 'native-midi': 'midi', 'midi2-native': 'midi', 'ble-midi': 'bluetooth',
    'microphone-formant': 'microphone', 'leap-motion': 'hand', 'onscreen-keyboard': 'piano',
    'prompt-ai': 'sparkles', 'prompt-ai-speech': 'speech', 'midi-transport-clock': 'clock',
    'music-mouse': 'mouse', 'microphone-pitch': 'microphone', 'dvs-control-vinyl': 'vinyl'
}

const OUTPUT_ICONS: Record<OutputId, string> = {
    moog: 'synth',
    tb303: 'synth',
    describe: 'describe', console: 'console', 'pink-trombone': 'speech', notation: 'notation',
    'spectrum-analyser': 'spectrum', 'speech-synthesis': 'speech', vibrator: 'vibration',
    webmidi: 'midi', 'native-midi': 'midi', 'ble-midi': 'bluetooth', midi2: 'midi', 'midi2-native': 'midi',
    supersonic: 'synth', wam2: 'plugin', wam: 'plugin', yoshimi: 'synth', metronome: 'clock',
    'audio-click': 'clock', butterchurn: 'visualizer', 'drum-accompaniment': 'drums'
}

export function elementIcon(kind: ElementKind, id: string): string {
    if (kind === 'input' && MIDI_DEVICE_PROFILES[id]?.icon) return MIDI_DEVICE_PROFILES[id].icon!
    const path = kind === 'output' && id.startsWith('webclap:') ? '/icons/output-webclap.svg'
        : kind === 'transformer' ? getTransformerIcon(id)
        : `/icons/device-${kind === 'input' ? INPUT_ICONS[id as InputId] ?? 'input'
            : kind === 'output' ? OUTPUT_ICONS[id as OutputId] ?? 'output' : 'instrument'}.svg`
    return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}

export function deviceIcon(device: object, direction: 'input' | 'output'): string {
    try {
        const definition = deviceDefinition(device)
        if (definition.factory === 'keyboard-input' || definition.factory === 'keyboard-output') {
            return elementIcon('input', 'onscreen-keyboard')
        }
        const kind = definition.factory === 'instrument' || definition.factory === 'polyphonic' ? 'instrument' : direction
        return elementIcon(kind, definition.type ?? '')
    } catch {
        return elementIcon(direction, '')
    }
}
