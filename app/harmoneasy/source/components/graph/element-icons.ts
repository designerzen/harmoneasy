import { deviceDefinition } from 'audiobus/io/device-definition'
import { getTransformerIcon } from 'audiobus/io/transformer-definitions'
import type { InputId } from 'audiobus/io/inputs/input-types'
import type { OutputId } from 'audiobus/io/outputs/output-types'

export type ElementKind = 'input' | 'output' | 'instrument' | 'transformer'

const INPUT_ICONS: Record<InputId, string> = {
    keyboard: 'keyboard', gamepad: 'gamepad', 'gamepad-music': 'gamepad',
    webmidi: 'midi', 'native-midi': 'midi', 'midi2-native': 'midi', 'ble-midi': 'bluetooth',
    'microphone-formant': 'microphone', 'leap-motion': 'hand', 'onscreen-keyboard': 'piano',
    'prompt-ai': 'sparkles', 'prompt-ai-speech': 'speech', 'midi-transport-clock': 'clock',
    'music-mouse': 'mouse', 'microphone-pitch': 'microphone', 'dvs-control-vinyl': 'vinyl'
}

const OUTPUT_ICONS: Record<OutputId, string> = {
    describe: 'describe', console: 'console', 'pink-trombone': 'speech', notation: 'notation',
    'spectrum-analyser': 'spectrum', 'speech-synthesis': 'speech', vibrator: 'vibration',
    webmidi: 'midi', 'native-midi': 'midi', 'ble-midi': 'bluetooth', midi2: 'midi', 'midi2-native': 'midi',
    supersonic: 'synth', wam2: 'plugin', yoshimi: 'synth', metronome: 'clock',
    'audio-click': 'clock', butterchurn: 'visualizer'
}

export function elementIcon(kind: ElementKind, id: string): string {
    const path = kind === 'transformer' ? getTransformerIcon(id)
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
