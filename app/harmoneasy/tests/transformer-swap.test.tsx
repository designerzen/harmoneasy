// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TransformerPicker } from '../source/components/graph/Transformers'
import { ChainContext } from '../source/components/graph/ChainContext'
import TransformerManager from '../../../packages/audiobus/io/transformer-manager-worker'
import { tranformerFactory } from '../../../packages/audiobus/io/transformer-factory'
import { ID_HARMONISER } from '../../../packages/audiobus/io/transformers/transformer-harmoniser'
import { ID_TRANSPOSER } from '../../../packages/audiobus/io/transformers/transformer-transposer'
import { ID_QUANTISE } from '../../../packages/audiobus/io/transformers/transformer-quantise'

it('keeps a transformer until selection and swaps it at the same position', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const first = tranformerFactory(ID_HARMONISER), original = tranformerFactory(ID_TRANSPOSER), last = tranformerFactory(ID_QUANTISE)
    const manager = new TransformerManager([first, original, last] as any)
    const destroy = vi.spyOn(original, 'destroy')
    const chain = { transformerManager: manager, clearNoteCommands: vi.fn(), setTransformers: manager.setTransformers.bind(manager) }
    const onAdded = vi.fn()
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    try {
        await act(async () => root.render(<ChainContext.Provider value={{ chain } as any}>
            <TransformerPicker replacing={original as any} onAdded={onAdded} />
        </ChainContext.Provider>))
        expect(manager.activeTransformers).toEqual([first, original, last])
        expect(destroy).not.toHaveBeenCalled()
        await act(async () => host.querySelector<HTMLButtonElement>('.element-choice')!.click())
        expect(manager.activeTransformers).toHaveLength(3)
        expect(manager.activeTransformers[0]).toBe(first)
        expect(manager.activeTransformers[1]).not.toBe(original)
        expect(manager.activeTransformers[2]).toBe(last)
        expect(destroy).toHaveBeenCalledOnce()
        expect(chain.clearNoteCommands).toHaveBeenCalledOnce()
        expect(onAdded).toHaveBeenCalledOnce()
    } finally {
        await act(async () => root.unmount())
        host.remove()
        manager.destroy()
    }
})
