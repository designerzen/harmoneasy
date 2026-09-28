import { INPUT_GUIDANCE, OUTPUT_GUIDANCE } from '../source/components/graph/device-card'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InputManager from '../../../packages/audiobus/io/input-manager'
import OutputManager from '../../../packages/audiobus/io/output-manager'
import { INPUT_FACTORIES } from '../../../packages/audiobus/io/input-factory'
import { OUTPUT_FACTORIES } from '../../../packages/audiobus/io/output-factory'
import * as inputTypes from '../../../packages/audiobus/io/inputs/input-types'
import * as outputTypes from '../../../packages/audiobus/io/outputs/output-types'

afterEach(() => vi.restoreAllMocks())

describe('Device selector catalogs', () => {
    it.each([
        ['input', INPUT_FACTORIES, inputTypes, () => new InputManager().getAvailableFactories()],
        ['output', OUTPUT_FACTORIES, outputTypes, () => new OutputManager().getAvailableFactories()],
    ] as const)('lists every supported %s type through its manager', async (_, factories, types, available) => {
        expect(factories.map(factory => factory.id).sort()).toEqual(Object.values(types).sort())
        for (const factory of factories) vi.spyOn(factory, 'isAvailable').mockReturnValue(true)
        expect(await available()).toEqual(factories)
        vi.mocked(factories[0].isAvailable).mockReturnValue(false)
        expect(await available()).toEqual(factories.slice(1))
    })
})

it('provides selection guidance for every registered input and output', () => {
    for (const [factories, guidance] of [[INPUT_FACTORIES, INPUT_GUIDANCE], [OUTPUT_FACTORIES, OUTPUT_GUIDANCE]] as const) {
        expect(Object.keys(guidance).sort()).toEqual(factories.map(factory => factory.id).sort())
        for (const entry of Object.values(guidance)) {
            for (const key of ['icon', 'usedFor', 'usefulFor', 'requirements'] as const) {
                expect(entry[key].trim().length).toBeGreaterThan(0)
            }
        }
    }
})
