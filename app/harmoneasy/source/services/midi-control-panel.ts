import type IOChainManager from 'audiobus/io/IO-chain-manager'
import type { Transformer } from 'audiobus/io/transformers/abstract-transformer'
import { MidiControls, DEFAULT_MIDI_BINDINGS, scaleMidiValue, type MidiTarget } from './midi-controls'

type Control = HTMLElement
const selector = 'button, summary, a[href], select, input[type="range"], input[type="number"], input[type="checkbox"], input[type="radio"]'

function controlName(element: Control): string {
    const label = element.closest('label') ?? (element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.labels?.[0] : null)
    const labelText = label ? [...label.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : ''
    return element.getAttribute('data-midi-control') || element.getAttribute('name') || labelText
        || element.getAttribute('aria-label') || element.title || element.textContent?.trim() || element.className || element.tagName
}

export function domMidiTargets(root: Document): MidiTarget[] {
    const occurrences = new Map<object, Map<string, number>>()
    const targets = new Map<string, MidiTarget>()
    for (const element of root.querySelectorAll<Control>(selector)) {
        if (element.closest('[data-midi-ignore]')) continue
        const stableId = element.id && !element.id.startsWith('_r_') && !element.id.startsWith(':') ? element.id : ''
        const scope = element.closest<HTMLElement>('[data-midi-scope]')
            ?? (stableId ? element : element.parentElement?.closest<HTMLElement>('[id]'))
        const scopeName = scope?.dataset.midiScope ?? (stableId ? 'app' : scope?.id) ?? 'app'
        const name = controlName(element)
        // React useId IDs change on remount; use semantic names within explicit scopes.
        const action = !(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)
        const semanticId = element.dataset.midiControl || element.getAttribute('name')
            || (action && element.className ? element.className : name)
        const localId = scope?.dataset.midiScope ? `${element.tagName}:${semanticId}` : stableId || `${element.tagName}:${semanticId}`
        const base = `${scopeName}:${localId}`
        const owner = scope ?? root
        let counts = occurrences.get(owner)
        if (!counts) occurrences.set(owner, counts = new Map())
        const count = counts.get(base) ?? 0
        counts.set(base, count + 1)
        const id = count ? `${base}:${count}` : base
        const displayScope = scope?.dataset.midiLabel ?? scope?.getAttribute('aria-label') ?? scopeName
        targets.set(id, { id, label: `${displayScope} / ${name}`, kind: action ? 'action' : 'value',
            apply(value) {
                if (element.matches(':disabled') || (element instanceof HTMLInputElement && element.readOnly)) return
                if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) { element.click(); return }
                if (element instanceof HTMLSelectElement) {
                    const options = [...element.options].filter(o => !o.disabled && !(o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled))
                    if (!options.length) return
                    const next = options[scaleMidiValue(value, 0, options.length - 1)].value
                    // The native setter also works with React controlled selects.
                    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, next)
                } else if (element.type === 'checkbox' || element.type === 'radio') {
                    const checked = value >= 64
                    if (element.checked === checked || (element.type === 'radio' && !checked)) return
                    element.click()
                    return
                } else {
                    const min = element.min ? Number(element.min) : 0
                    const max = element.max ? Number(element.max) : 127
                    const step = element.step === 'any' ? 0 : Number(element.step || 1)
                    const next = String(scaleMidiValue(value, min, max, step))
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, next)
                }
                element.dispatchEvent(new Event('input', { bubbles: true }))
                element.dispatchEvent(new Event('change', { bubbles: true }))
            }
        })
    }
    // Expanded graph views may mirror the same control. Prefer the expanded view.
    return [...targets.values()]
}

export function createMidiControlPanel(manager: IOChainManager, saved: string | undefined,
    persist: (serialized: string) => void): MidiControls {
    const host = document.getElementById('midi-control-settings')!
    let settings: { bindings?: unknown; enabled?: boolean } = {}
    try { if (saved) settings = JSON.parse(saved) ?? {} } catch { /* Keep defaults for invalid URL settings. */ }
    const targets = () => {
        const result = domMidiTargets(document)
        for (const [chainId, chain] of manager.entries) {
            for (const item of chain.transformers) {
                const transformer = item as Transformer<any>
                for (const field of transformer.fields) {
                    if (field.type !== 'select' || !field.values?.length) continue
                    result.push({ id: `${chainId}:transformer:${transformer.midiControlId}:${field.name}`,
                        label: `${chain.options.name} / ${transformer.name} / ${field.name}`, kind: 'value',
                        apply(value) {
                            const choice = field.values[scaleMidiValue(value, 0, field.values.length - 1)]
                            transformer.setConfig(field.name, typeof choice === 'object' && choice !== null ? choice.value : choice)
                            chain.dispatchEvent(new Event('configurationChanged'))
                        }
                    })
                }
            }
        }
        return result
    }
    const controls = new MidiControls(targets, settings.bindings ?? DEFAULT_MIDI_BINDINGS, () => {
        persist(JSON.stringify({ enabled: controls.enabled, bindings: controls.bindings }))
        renderBindings()
    })
    controls.enabled = settings.enabled !== false
    manager.controlChangeHandler = controls.handle
    host.dataset.midiIgnore = ''
    host.innerHTML = `<label><input type="checkbox" data-role="enabled"> Enable MIDI control</label>
        <p>Defaults use channel 16: CC 7 volume, 20 tempo, 21 metronome, 22 play, 23 stop, 24 rewind, 123 panic.
        Mapped CCs are consumed; other messages continue to instruments. Buttons fire at 64–127 after release below 64.</p>
        <p>Choose a control, then Learn and move a MIDI knob or press a button. Connect a MIDI input to a chain first.
        Menus and devices added later appear when you refresh. Text entry and file/device permission dialogs require the keyboard or mouse.</p>
        <label>Control <select data-role="target"></select></label>
        <button type="button" data-role="refresh">Refresh controls</button>
        <button type="button" data-role="learn">Learn</button>
        <button type="button" data-role="cancel">Cancel learn</button>
        <label>CC <input data-role="cc" type="number" min="0" max="127" value="20"></label>
        <label>Channel <select data-role="channel"><option value="0">All</option>${Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></label>
        <button type="button" data-role="assign">Assign (any device)</button>
        <p role="status" data-role="status"></p><ul data-role="bindings"></ul>`
    const get = <T extends HTMLElement>(role: string) => host.querySelector<T>(`[data-role="${role}"]`)!
    const targetSelect = get<HTMLSelectElement>('target')
    const status = get('status')
    const refresh = () => {
        const selected = targetSelect.value
        targetSelect.replaceChildren(...targets().map(target => {
            const option = document.createElement('option')
            option.textContent = target.label
            option.value = target.id
            return option
        }))
        if ([...targetSelect.options].some(o => o.value === selected)) targetSelect.value = selected
        renderBindings()
    }
    function renderBindings() {
        const available = targets()
        get('bindings').replaceChildren(...controls.bindings.map(binding => {
            const item = document.createElement('li')
            const target = available.find(t => t.id === binding.target)
            item.append(`${target?.label ?? binding.target + ' (unavailable)'} — CC ${binding.cc}, channel ${binding.channel || 'All'}, ${binding.source || 'any device'} `)
            const remove = document.createElement('button')
            remove.type = 'button'
            remove.textContent = 'Remove'
            remove.onclick = () => controls.remove(binding.target)
            item.append(remove)
            return item
        }))
        status.textContent = controls.learning ? 'Waiting for a MIDI CC…' : ''
    }
    const enabled = get<HTMLInputElement>('enabled')
    enabled.checked = controls.enabled
    enabled.onchange = () => {
        controls.enabled = enabled.checked
        controls.learning = null
        persist(JSON.stringify({ enabled: controls.enabled, bindings: controls.bindings }))
        renderBindings()
    }
    get('refresh').onclick = refresh
    get('learn').onclick = () => { controls.learning = targetSelect.value || null; renderBindings() }
    get('cancel').onclick = () => { controls.learning = null; renderBindings() }
    get('assign').onclick = () => {
        try {
            controls.assign({ target: targetSelect.value, cc: get<HTMLInputElement>('cc').valueAsNumber,
                channel: Number(get<HTMLSelectElement>('channel').value), source: '' })
        } catch (error) { status.textContent = String(error) }
    }
    document.getElementById('settings-dialog')?.addEventListener('toggle', event => {
        if ((event as ToggleEvent).newState === 'closed') controls.learning = null
        refresh()
    })
    manager.addEventListener('chainsUpdated', refresh)
    refresh()
    return controls
}
