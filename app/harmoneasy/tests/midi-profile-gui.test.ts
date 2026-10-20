// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMidiDeviceProfiles, MIDI_DEVICE_PROFILES } from '../../../packages/audiobus/midi/device-profiles'
import { parseMidiDeviceProfile, profileMessageBytes } from '../../../packages/audiobus/midi/device-profile-schema'
import { createProfiledMidiGui } from '../../../packages/audiobus/io/inputs/profiled-midi-gui'
import { midiToCommand } from '../../../packages/audiobus/midi/midi-command-conversion'
import { EVENT_CHANGE, EVENT_CLICK, EVENT_INPUT, EVENT_KEY_DOWN, EVENT_KEY_UP, EVENT_POINTER_DOWN, EVENT_POINTER_MOVE, EVENT_POINTER_UP } from '../../../packages/audiobus/event-constants'

const fixture = () => ({
    schemaVersion: 1, name: 'Folder instrument', icon: 'images/icon.svg',
    controls: [
        { id: 'x', label: 'Horizontal', cc: 11 },
        { id: 'y', label: 'Vertical', cc: 12 },
        { id: 'gate', label: 'Gate', widget: 'toggle', cc: 64 },
        { id: 'patch', label: 'Patch', widget: 'select', default: 4, message: { type: 'programChange' }, options: [{ label: 'Warm', value: 4 }, { label: 'Bright', value: 9 }] },
        { id: 'note', label: 'Play', widget: 'button', max: 100, message: { type: 'note', number: 60, channel: 2 } },
        { id: 'bend', label: 'Pitch', default: 8192, message: { type: 'pitchBend' } },
        { id: 'macro', label: 'Macro', widget: 'button', cc: 102, messages: [{ type: 'cc', number: 102 }, { type: 'sysex', bytes: [240, 125, 'value', 247] }] },
        { id: 'level', label: 'Level', widget: 'meter', cc: 10 }
    ],
    gui: { type: 'column', children: [
        { type: 'status' }, { type: 'notes' }, { type: 'channel' },
        { type: 'tabs', label: 'Performance pages', children: [
            { type: 'column', label: 'Play', children: [
                { type: 'overlay', children: [
                    { type: 'image', src: 'images/panel.svg', alt: 'Device surface' },
                    { type: 'control', control: 'gate', position: { x: 30, y: 40, width: 25 } }
                ] },
                { type: 'grid', columns: 2, children: [{ type: 'controls', controls: ['x', 'y', 'patch', 'note', 'bend', 'macro', 'level'] }] },
                { type: 'xy', x: 'x', y: 'y', label: 'Expression pad' }
            ] },
            { type: 'column', label: 'Mirror', children: [{ type: 'text', text: 'Second control view' }, { type: 'control', control: 'x' }] }
        ] }
    ] }
})
const assets = { './devices/folder-instrument/images/icon.svg': '/emitted/icon.svg', './devices/folder-instrument/images/panel.svg': '/emitted/panel.svg' }
function profile(raw: unknown = fixture()) { return parseMidiDeviceProfile('folder-instrument', raw, path => assets[`./devices/folder-instrument/${path}` as keyof typeof assets]) }
afterEach(() => document.body.replaceChildren())

describe('device folders and declarative GUIs', () => {
    it('automatically loads folder identities and resolves only their local assets', () => {
        const report = vi.fn()
        const loaded = loadMidiDeviceProfiles({
            './devices/folder-instrument/folder-instrument.json': fixture(),
            './devices/broken-instrument/broken-instrument.json': { schemaVersion: 99 },
            './devices/profile.schema.json': {}
        }, assets, report)
        expect(Object.keys(loaded)).toEqual(['folder-instrument'])
        expect(loaded['folder-instrument'].ids).toEqual(['folder-instrument'])
        expect(loaded['folder-instrument'].icon).toBe('/emitted/icon.svg')
        expect(report).toHaveBeenCalledTimes(1)
        const gui = createProfiledMidiGui(loaded['folder-instrument'], {}, vi.fn(), vi.fn())
        expect(gui.element.querySelector('img')?.getAttribute('src')).toBe('/emitted/panel.svg')
        expect(gui.element.querySelector('[data-gui-type="control"]')?.getAttribute('style')).toContain('left: 30%')
        gui.destroy()
    })
    it('loads both real devices, their images and their GUI trees directly from folders', () => {
        expect(Object.keys(MIDI_DEVICE_PROFILES)).toEqual(expect.arrayContaining(['arcana-strum', 'digit-cmpsr']))
        for (const device of Object.values(MIDI_DEVICE_PROFILES)) {
            const gui = createProfiledMidiGui(device, {}, vi.fn(), vi.fn())
            expect(gui.element.dataset.deviceProfile).toBe(device.id)
            expect(gui.element.querySelector('img')?.getAttribute('src')).toContain(`/midi-devices/${device.id}/panel.svg`)
            expect(device.icon).toContain(`/midi-devices/${device.id}/icon.svg`)
            gui.destroy()
        }
    })
    it.each([
        ['missing image', (raw: any) => { raw.gui.children[3].children[0].children[0].children[0].src = 'missing.svg' }],
        ['folder traversal', (raw: any) => { raw.icon = '../another/icon.svg' }],
        ['unknown control', (raw: any) => { raw.gui.children.push({ type: 'control', control: 'absent' }) }],
        ['invalid CC', (raw: any) => { raw.controls[0].cc = 128 }],
        ['invalid channel', (raw: any) => { raw.controls[4].message.channel = 0 }],
        ['invalid SysEx', (raw: any) => { raw.controls[6].messages[1].bytes = [240, 200, 247] }],
        ['duplicate control', (raw: any) => { raw.controls.push(raw.controls[0]) }],
        ['unsupported node', (raw: any) => { raw.gui.children.push({ type: 'script', text: 'anything' }) }],
        ['invalid overlay', (raw: any) => { raw.gui.children.push({ type: 'text', position: { x: 200, y: 0 } }) }]
    ])('rejects %s without accepting a broken device profile', (_name, change) => {
        const raw = fixture(); change(raw)
        expect(() => profile(raw)).toThrow()
    })
    it('updates mirrored controls, meters and XY feedback without generating extra MIDI', () => {
        const perform = vi.fn()
        const gui = createProfiledMidiGui(profile(), {}, perform, vi.fn())
        gui.setConnected(true, 'controller')
        gui.receive(midiToCommand([0xb0, 11, 64], 0, 'controller')!)
        const mirrored = gui.element.querySelectorAll<HTMLInputElement>('[data-midi-control="x"]')
        expect([...mirrored].map(input => input.value)).toEqual(['64', '64'])
        const dot = gui.element.querySelector<HTMLSpanElement>('[aria-label="Expression pad"] span')!
        expect(parseFloat(dot.style.left)).toBeCloseTo(64 / 127 * 100)
        gui.receive(midiToCommand([0xb0, 10, 93], 0, 'controller')!)
        // happy-dom clamps meter property getters to 0–1 regardless of max.
        expect(gui.element.querySelector('meter')?.getAttribute('value')).toBe('93')
        expect(perform).not.toHaveBeenCalled()
        gui.destroy()
    })
    it('sends sliders, toggles, programs, pitch bend and multi-message controls from JSON', () => {
        const perform = vi.fn()
        const gui = createProfiledMidiGui(profile(), { selectedChannel: 3 }, perform, vi.fn())
        gui.setConnected(true, 'controller')
        const input = <T extends HTMLElement>(id: string) => gui.element.querySelector<T>(`[data-midi-control="${id}"]`)!
        input<HTMLInputElement>('x').value = '90'
        input('x').dispatchEvent(new Event(EVENT_INPUT))
        expect(perform).toHaveBeenLastCalledWith({ type: 'cc', number: 11, channel: 3 }, 90)
        input<HTMLInputElement>('gate').checked = true
        input('gate').dispatchEvent(new Event(EVENT_CHANGE))
        expect(perform).toHaveBeenLastCalledWith({ type: 'cc', number: 64, channel: 3 }, 127)
        input<HTMLSelectElement>('patch').value = '9'
        input('patch').dispatchEvent(new Event(EVENT_CHANGE))
        expect(perform).toHaveBeenLastCalledWith({ type: 'programChange', channel: 3 }, 9)
        input<HTMLInputElement>('bend').value = '16383'
        input('bend').dispatchEvent(new Event(EVENT_INPUT))
        expect(perform).toHaveBeenLastCalledWith({ type: 'pitchBend', channel: 3 }, 16383)
        input('macro').dispatchEvent(new Event(EVENT_CLICK))
        expect(perform.mock.calls.slice(-2)).toEqual([[{ type: 'cc', number: 102, channel: 3 }, 127], [{ type: 'sysex', bytes: [240, 125, 'value', 247], channel: 3 }, 127]])
        gui.destroy()
    })
    it('releases momentary notes on key-up, channel changes, disconnect and destruction', () => {
        const perform = vi.fn(), changed = vi.fn(), options = { selectedChannel: 3 }
        const gui = createProfiledMidiGui(profile(), options, perform, changed)
        gui.setConnected(true, 'controller')
        const button = gui.element.querySelector<HTMLButtonElement>('[data-midi-control="note"]')!
        const press = () => button.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: ' ' }))
        press()
        expect(perform).toHaveBeenLastCalledWith({ type: 'note', number: 60, channel: 2 }, 100)
        button.dispatchEvent(new KeyboardEvent(EVENT_KEY_UP, { key: ' ' }))
        expect(perform).toHaveBeenLastCalledWith({ type: 'note', number: 60, channel: 2 }, 0)
        press()
        const channel = gui.element.querySelector<HTMLSelectElement>('[data-midi-control="channel"]')!
        channel.value = '5'; channel.dispatchEvent(new Event(EVENT_CHANGE))
        expect(perform).toHaveBeenLastCalledWith({ type: 'note', number: 60, channel: 2 }, 0)
        expect(changed).toHaveBeenCalledTimes(1)
        press(); gui.setConnected(false, 'controller')
        expect(perform).toHaveBeenLastCalledWith({ type: 'note', number: 60, channel: 2 }, 0)
        expect(button.disabled).toBe(true)
        gui.setConnected(true, 'controller'); press(); gui.destroy()
        expect(perform).toHaveBeenLastCalledWith({ type: 'note', number: 60, channel: 2 }, 0)
    })
    it('switches JSON tabs with mouse and keyboard without leaving hidden layouts visible', () => {
        const gui = createProfiledMidiGui(profile(), {}, vi.fn(), vi.fn())
        document.body.append(gui.element)
        const tabs = gui.element.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        const panels = gui.element.querySelectorAll<HTMLElement>('[role="tabpanel"]')
        expect(panels[1].style.display).toBe('none')
        tabs[1].click()
        expect(panels[0].style.display).toBe('none')
        expect(panels[1].style.display).toBe('flex')
        tabs[1].dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: 'ArrowRight' }))
        expect(tabs[0].getAttribute('aria-selected')).toBe('true')
        expect(panels[0].style.display).toBe('flex')
        gui.destroy()
    })
    it('performs paired XY controls with pointer capture, clamping and keyboard input', () => {
        const perform = vi.fn()
        const gui = createProfiledMidiGui(profile(), {}, perform, vi.fn())
        gui.setConnected(true, 'controller')
        const pad = gui.element.querySelector<HTMLButtonElement>('[aria-label="Expression pad"]')!
        Object.defineProperty(pad, 'setPointerCapture', { configurable: true, value: vi.fn() })
        vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect)
        pad.dispatchEvent(new PointerEvent(EVENT_POINTER_DOWN, { button: 0, pointerId: 3, clientX: 25, clientY: 75 }))
        expect(perform.mock.calls).toEqual([[{ type: 'cc', number: 11, channel: 1 }, 32], [{ type: 'cc', number: 12, channel: 1 }, 32]])
        pad.dispatchEvent(new PointerEvent(EVENT_POINTER_MOVE, { pointerId: 3, clientX: 200, clientY: -10 }))
        expect(perform.mock.calls.slice(-2)).toEqual([[{ type: 'cc', number: 11, channel: 1 }, 127], [{ type: 'cc', number: 12, channel: 1 }, 127]])
        pad.dispatchEvent(new PointerEvent(EVENT_POINTER_UP, { pointerId: 3 }))
        const calls = perform.mock.calls.length
        pad.dispatchEvent(new PointerEvent(EVENT_POINTER_MOVE, { pointerId: 3, clientX: 50, clientY: 50 }))
        expect(perform).toHaveBeenCalledTimes(calls)
        pad.dispatchEvent(new KeyboardEvent(EVENT_KEY_DOWN, { key: 'ArrowLeft' }))
        expect(perform).toHaveBeenLastCalledWith({ type: 'cc', number: 11, channel: 1 }, 126)
        gui.destroy()
    })
    it('encodes supported MIDI messages with explicit channels and their proper resolutions', () => {
        expect(profileMessageBytes({ type: 'cc', number: 102 }, 127, 3)).toEqual([0xb2, 102, 127])
        expect(profileMessageBytes({ type: 'note', number: 60, channel: 2 }, 0, 3)).toEqual([0x81, 60, 0])
        expect(profileMessageBytes({ type: 'pitchBend' }, 8192, 1)).toEqual([0xe0, 0, 64])
        expect(profileMessageBytes({ type: 'programChange' }, 5, 1)).toEqual([0xc0, 5])
        expect(profileMessageBytes({ type: 'channelPressure' }, 70, 16)).toEqual([0xdf, 70])
        expect(profileMessageBytes({ type: 'sysex', bytes: [240, 125, 'value', 247] }, 90, 1)).toEqual([240, 125, 90, 247])
    })
})
