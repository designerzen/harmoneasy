// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MidiControls, scaleMidiValue } from '../source/services/midi-controls'
import { createMidiControlPanel, domMidiTargets } from '../source/services/midi-control-panel'
import IOChain from '../../../packages/audiobus/io/IO-chain'
import IOChainManager from '../../../packages/audiobus/io/IO-chain-manager'
import AbstractInput from '../../../packages/audiobus/io/inputs/abstract-input'
import { TransformerHarmoniser } from '../../../packages/audiobus/io/transformers/transformer-harmoniser'

const cc = (value: number, options = {}) => ({ type: 'controlChange', number: 20, channel: 16, from: 'controller', value, ...options } as any)
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })

describe('MIDI CC mappings', () => {
    it('filters sources and channels, leaves unrelated MIDI untouched, and supports all channels', () => {
        const apply = vi.fn()
        const controls = new MidiControls(() => [{ id: 'tempo', label: 'Tempo', kind: 'value', apply }],
            [{ target: 'tempo', cc: 20, channel: 2, source: 'keyboard' }])
        expect(controls.handle(cc(50))).toBe(false)
        expect(controls.handle(cc(50, { channel: 2, from: 'keyboard' }))).toBe(true)
        expect(apply).toHaveBeenCalledExactlyOnceWith(50)
        controls.assign({ target: 'tempo', cc: 20, channel: 0, source: '' })
        expect(controls.handle(cc(100, { channel: 1 }))).toBe(true)
        expect(controls.handle(cc(50, { type: 'noteOn' }))).toBe(false)
        expect(controls.handle(cc(NaN))).toBe(false)
        controls.enabled = false
        expect(controls.handle(cc(127))).toBe(false)
    })
    it('fires actions on a rising threshold once per press and does not execute during learning', () => {
        const apply = vi.fn()
        const changed = vi.fn()
        const controls = new MidiControls(() => [{ id: 'panic', label: 'Panic', kind: 'action', apply }], [], changed)
        controls.learning = 'panic'
        expect(controls.handle(cc(127))).toBe(true)
        expect(apply).not.toHaveBeenCalled()
        expect(controls.bindings).toEqual([{ target: 'panic', cc: 20, channel: 16, source: 'controller' }])
        controls.handle(cc(100))
        controls.handle(cc(0))
        controls.handle(cc(64))
        controls.handle(cc(127))
        expect(apply).toHaveBeenCalledTimes(1)
        expect(changed).toHaveBeenCalledTimes(1)
        controls.remove('panic')
        expect(controls.handle(cc(127))).toBe(false)
    })
    it('rejects invalid stored mappings and assignment ranges', () => {
        const controls = new MidiControls(() => [], [{ target: 'x', cc: 128, source: '', channel: 0 }, null])
        expect(controls.bindings).toEqual([])
        expect(() => controls.assign({ target: 'x', cc: 4, source: '', channel: 17 })).toThrow()
        expect(scaleMidiValue(0, -12, 12)).toBe(-12)
        expect(scaleMidiValue(127, -12, 12)).toBe(12)
        expect(scaleMidiValue(64, 0, 1, .01)).toBe(.5)
    })
    it('drives ranges, checkboxes, selects and actions through existing UI events', () => {
        document.body.innerHTML = `<input id="volume" type="range" min="0" max="100"><select id="instrument"><option disabled>Choose</option><option value="piano">Piano</option><option value="organ">Organ</option></select><input id="enabled" type="checkbox"><button id="panic">Panic</button>`
        const targets = domMidiTargets(document)
        expect(targets.map(t => t.id)).toEqual(['app:volume', 'app:instrument', 'app:enabled', 'app:panic'])
        const input = vi.fn(), change = vi.fn(), click = vi.fn()
        document.getElementById('volume')!.addEventListener('input', input)
        document.getElementById('instrument')!.addEventListener('change', change)
        document.getElementById('panic')!.addEventListener('click', click)
        const apply = (id: string, value: number) => targets.find(t => t.id === `app:${id}`)!.apply(value)
        apply('volume', 127)
        apply('instrument', 127)
        apply('enabled', 127)
        apply('enabled', 100)
        apply('panic', 127)
        expect((document.getElementById('volume') as HTMLInputElement).value).toBe('100')
        expect((document.getElementById('instrument') as HTMLSelectElement).value).toBe('organ')
        expect((document.getElementById('enabled') as HTMLInputElement).checked).toBe(true)
        expect(input).toHaveBeenCalledTimes(1)
        expect(change).toHaveBeenCalledTimes(1)
        expect(click).toHaveBeenCalledTimes(1)
    })
    it('keeps scoped keys stable as titles change and resolves mirrored controls to the expanded view', () => {
        document.body.innerHTML = `<section data-midi-scope="chain-1"><button class="power" title="Deactivate">Power</button></section>`
        const id = domMidiTargets(document)[0].id
        document.querySelector('button')!.title = 'Activate'
        expect(domMidiTargets(document)[0].id).toBe(id)
        document.body.insertAdjacentHTML('beforeend', `<section data-midi-scope="chain-1"><button class="power" title="Activate">Power</button></section>`)
        const first = vi.fn(), second = vi.fn()
        document.querySelectorAll('button')[0].onclick = first
        document.querySelectorAll('button')[1].onclick = second
        const targets = domMidiTargets(document)
        expect(targets).toHaveLength(1)
        targets[0].apply(127)
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)
    })
    it('updates a React controlled select through its onChange handler', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
        const host = document.createElement('div')
        document.body.append(host)
        const root = createRoot(host)
        const change = vi.fn()
        await act(async () => root.render(React.createElement('select', { id: 'preset', value: 'a', onChange: change },
            React.createElement('option', { value: 'a' }, 'A'), React.createElement('option', { value: 'b' }, 'B'))))
        await act(async () => domMidiTargets(document)[0].apply(127))
        expect(change).toHaveBeenCalledTimes(1)
        await act(async () => root.unmount())
    })
    it('keeps React generated IDs out of persisted keys and exposes expandable menus', () => {
        document.body.innerHTML = '<menu id="add-iochain"><label for="_r_1_">New chain</label><select id="_r_1_"><option>A</option></select><details><summary>Devices</summary></details></menu>'
        const first = domMidiTargets(document)
        const select = document.querySelector('select')!
        select.id = '_r_2_'
        document.querySelector('label')!.htmlFor = select.id
        expect(domMidiTargets(document).map(t => t.id)).toEqual(first.map(t => t.id))
        const click = vi.fn()
        document.querySelector('summary')!.addEventListener('click', click)
        first.find(t => t.kind === 'action')!.apply(127)
        expect(click).toHaveBeenCalledTimes(1)
    })
})

class Input extends AbstractInput {}
function workspace() {
    const timer = { now: 0, BPM: 120, isRunning: false } as any
    const input = new Input()
    const manager = new IOChainManager({ timer, outputMixer: {} as GainNode, externalDevices: { input } })
    const chain = new IOChain(timer)
    chain.setTransformers([])
    chain.addInput(input)
    const id = manager.addChain(chain)
    return { manager, chain, input, id, timer }
}

describe('MIDI control routing and persistence', () => {
    it('consumes a shared input once, even when chains are inactive, while passing unmatched CCs to outputs', async () => {
        const { manager, chain, input, id } = workspace()
        const clone = manager.getChain(manager.cloneChain(id))!
        const a = vi.spyOn(chain.outputManager, 'triggerAudioCommandsOnOutputs').mockResolvedValue(undefined)
        const b = vi.spyOn(clone.outputManager, 'triggerAudioCommandsOnOutputs').mockResolvedValue(undefined)
        const handler = vi.fn(command => command.number === 20)
        manager.controlChangeHandler = handler
        chain.setActive(false)
        clone.setActive(false)
        input.dispatch(cc(127, { raw: new Uint8Array([0xbf, 20, 127]) }))
        expect(handler).toHaveBeenCalledTimes(1)
        expect(a).not.toHaveBeenCalled()
        expect(b).not.toHaveBeenCalled()
        chain.setActive(true)
        clone.setActive(true)
        input.dispatch(cc(50, { number: 1, raw: new Uint8Array([0xbf, 1, 50]) }))
        expect(handler).toHaveBeenCalledTimes(2)
        expect(a).toHaveBeenCalledTimes(1)
        expect(b).toHaveBeenCalledTimes(1)
        manager.destroy()
    })
    it('preserves transformer targets across workspace restoration and reorder', async () => {
        const { manager, chain, input, timer } = workspace()
        const transformer = new TransformerHarmoniser()
        chain.setTransformers([transformer])
        const controlId = transformer.midiControlId
        const restored = new IOChainManager({ timer, outputMixer: {} as GainNode, externalDevices: { input } })
        await restored.restoreWorkspace(manager.exportWorkspace())
        expect((restored.chains[0].transformers[0] as TransformerHarmoniser).midiControlId).toBe(controlId)
        expect(new TransformerHarmoniser().midiControlId).not.toBe(controlId)
        manager.destroy()
        restored.destroy()
    })
    it('learns in the panel, persists mappings, and applies transformer settings independently of graph rendering', () => {
        const { manager, chain } = workspace()
        const transformer = new TransformerHarmoniser()
        chain.setTransformers([transformer])
        document.body.innerHTML = '<dialog id="settings-dialog"><div id="midi-control-settings"></div></dialog>'
        const persist = vi.fn()
        const controls = createMidiControlPanel(manager, undefined, persist)
        const targetSelect = document.querySelector<HTMLSelectElement>('[data-role="target"]')!
        const option = [...targetSelect.options].find(o => o.value.endsWith(':enabled'))!
        expect(option).toBeDefined()
        targetSelect.value = option.value
        document.querySelector<HTMLButtonElement>('[data-role="learn"]')!.click()
        controls.handle(cc(0))
        expect(persist).toHaveBeenCalledTimes(1)
        const saved = persist.mock.calls[0][0]
        expect(JSON.parse(saved).bindings.some((b: any) => b.target === option.value)).toBe(true)
        const apply = vi.spyOn(transformer, 'setConfig')
        controls.handle(cc(127))
        expect(apply).toHaveBeenCalledWith('enabled', expect.anything())
        createMidiControlPanel(manager, saved, vi.fn())
        expect(manager.controlChangeHandler!(cc(0))).toBe(true)
        manager.destroy()
    })
})
