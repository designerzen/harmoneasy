// @vitest-environment happy-dom
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { defineDevice } from 'audiobus/io/device-definition'
import { TRANSFORMERS, TRANSFORMER_TYPE } from 'audiobus/io/transformer-factory'
import { TRANSFORMER_DEFINITIONS } from 'audiobus/io/transformer-definitions'
import { deviceIcon, elementIcon } from '../source/components/graph/element-icons'
import { fillDeviceCard, INPUT_GUIDANCE, OUTPUT_GUIDANCE } from '../source/components/graph/device-card'
import { CLAP_PATCHES } from '../../../packages/audiobus/instruments/clap/clap-catalog'
import { OUTPUT_DEFINITIONS } from '../../../packages/audiobus/io/output-definitions'
import { webclapOutputId } from '../../../packages/audiobus/io/outputs/output-types'
import { choiceMatches } from '../source/components/graph/device-filters'

const assetExists = (src: string) => existsSync(resolve('public', src.replace(/^\//, '')))

it('shows WebCLAP metadata and makes authors and licenses searchable', () => {
    for (const patch of CLAP_PATCHES.filter(patch => patch.features?.includes('instrument'))) {
        const choice = OUTPUT_DEFINITIONS[webclapOutputId(patch.id)]
        const button = document.createElement('button')
        fillDeviceCard(button, choice, 'output')
        expect(button.title).toContain(patch.title)
        expect(button.querySelector('.item-classification')?.textContent).toContain(patch.category)
        expect(button.querySelector('.item-attribution')?.textContent).toContain(patch.attribution!.author)
        expect(button.dataset.search).toContain(patch.attribution!.license.toLowerCase())
        expect(choiceMatches(choice, patch.attribution!.author, '')).toBe(true)
        expect(choiceMatches(choice, patch.attribution!.license, '')).toBe(true)
    }
})

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
            expect(button.querySelector<HTMLElement>('.element-icon')!.style.maskImage).toBe(`url("${deviceIcon(device, kind)}")`)
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
    expect(button.querySelector<HTMLElement>('.element-icon')!.style.maskImage).toBe(`url("${elementIcon('output', 'custom')}")`)
})
