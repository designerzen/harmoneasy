// @vitest-environment happy-dom
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { defineDevice } from 'audiobus/io/device-definition'
import { TRANSFORMERS, TRANSFORMER_TYPE } from 'audiobus/io/transformer-factory'
import { TRANSFORMER_DEFINITIONS } from 'audiobus/io/transformer-definitions'
import { deviceIcon, elementIcon } from '../source/components/graph/element-icons'
import { fillDeviceCard, INPUT_GUIDANCE, OUTPUT_GUIDANCE } from '../source/components/graph/device-card'

const assetExists = (src: string) => existsSync(resolve('public', src.replace(/^\//, '')))

it('has existing icon assets for every input, output, transformer and fallback', () => {
    for (const [kind, ids] of [
        ['input', Object.keys(INPUT_GUIDANCE)], ['output', Object.keys(OUTPUT_GUIDANCE)],
        ['transformer', [...TRANSFORMERS, ...Object.keys(TRANSFORMER_DEFINITIONS)]]
    ] as const) {
        for (const id of ids) {
            const src = elementIcon(kind, id)
            expect(assetExists(src), `${kind}: ${id}: ${src}`).toBe(true)
            if (kind === 'transformer') expect(TRANSFORMER_DEFINITIONS[id], id).toBeDefined()
        }
    }
    expect(TRANSFORMER_TYPE.ID_TIMING_HUMANISER).toBeDefined()
    expect(TRANSFORMER_TYPE.ID_VIBRATOR).toBeDefined()
    for (const kind of ['input', 'output', 'instrument', 'transformer'] as const) {
        expect(assetExists(elementIcon(kind, 'unknown'))).toBe(true)
    }
})

it('uses the same icon for each device card and registered device, including special factories', () => {
    for (const [kind, guidance] of [['input', INPUT_GUIDANCE], ['output', OUTPUT_GUIDANCE]] as const) {
        for (const id of Object.keys(guidance)) {
            const button = document.createElement('button')
            fillDeviceCard(button, { id, name: id, description: 'Description' }, kind)
            const device = defineDevice({}, { factory: kind, type: id })
            expect(button.querySelector('img')!.getAttribute('src')).toBe(deviceIcon(device, kind))
        }
    }
    for (const factory of ['instrument', 'polyphonic'] as const) {
        expect(deviceIcon(defineDevice({}, { factory, type: 'piano' }), 'output')).toBe(elementIcon('instrument', 'piano'))
    }
    for (const factory of ['keyboard-input', 'keyboard-output'] as const) {
        expect(deviceIcon(defineDevice({}, { factory }), 'input')).toBe(elementIcon('input', 'onscreen-keyboard'))
    }
    expect(assetExists(deviceIcon({}, 'output'))).toBe(true)
    const button = document.createElement('button')
    fillDeviceCard(button, { id: 'custom', name: 'Custom', description: 'Custom device' }, 'output')
    expect(button.querySelector('img')!.getAttribute('src')).toBe(elementIcon('output', 'custom'))
})
