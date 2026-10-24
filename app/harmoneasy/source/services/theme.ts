import { EVENT_CHANGE, EVENT_CLICK, EVENT_INPUT } from 'audiobus/event-constants'

export const THEME_STORAGE_KEY = 'harmoneasy.theme'
export const THEME_PRESETS = [
    { name: 'Violet', hue: 290 },
    { name: 'Ocean', hue: 250 },
    { name: 'Lagoon', hue: 190 },
    { name: 'Forest', hue: 145 },
    { name: 'Amber', hue: 75 },
    { name: 'Rose', hue: 15 }
] as const

type ThemeMode = 'system' | 'light' | 'dark'
type Theme = { hue: number; mode: ThemeMode }
const DEFAULT_THEME: Theme = { hue: THEME_PRESETS[0].hue, mode: 'system' }

function readTheme(doc: Document): Theme {
    try {
        const saved = JSON.parse(doc.defaultView?.localStorage.getItem(THEME_STORAGE_KEY) ?? 'null')
        return {
            hue: typeof saved?.hue === 'number' && Number.isFinite(saved.hue) && saved.hue >= 0 && saved.hue <= 360
                ? saved.hue : DEFAULT_THEME.hue,
            mode: ['system', 'light', 'dark'].includes(saved?.mode) ? saved.mode : DEFAULT_THEME.mode
        }
    } catch { return { ...DEFAULT_THEME } }
}

export function createThemeControls(doc: Document) {
    let theme = readTheme(doc)
    const preset = doc.getElementById('theme-preset') as HTMLSelectElement | null
    const mode = doc.getElementById('theme-mode') as HTMLSelectElement | null
    const hue = doc.getElementById('theme-hue') as HTMLInputElement | null
    const output = doc.getElementById('theme-hue-value') as HTMLOutputElement | null
    const reset = doc.getElementById('theme-reset')
    const status = doc.getElementById('theme-status')

    preset?.replaceChildren(...[...THEME_PRESETS.map(item => ({ value: String(item.hue), label: item.name })),
        { value: 'custom', label: 'Custom hue' }].map(item => {
        const option = doc.createElement('option')
        option.value = item.value
        option.textContent = item.label
        return option
    }))

    const render = () => {
        doc.documentElement.style.setProperty('--theme-hue', String(theme.hue))
        doc.documentElement.dataset.themeMode = theme.mode
        if (preset) preset.value = THEME_PRESETS.some(item => item.hue === theme.hue) ? String(theme.hue) : 'custom'
        if (mode) mode.value = theme.mode
        if (hue) hue.value = String(theme.hue)
        if (output) output.value = `${theme.hue}°`
    }
    const save = () => {
        render()
        try {
            doc.defaultView?.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme))
            if (status) status.textContent = 'Theme saved in this browser only.'
        } catch {
            if (status) status.textContent = 'Browser storage is unavailable. Theme applies for this visit.'
        }
    }
    const onPreset = () => {
        if (preset?.value === 'custom') { hue?.focus(); return }
        const selected = THEME_PRESETS.find(item => String(item.hue) === preset?.value)
        if (selected) { theme.hue = selected.hue; save() }
    }
    const onMode = () => {
        if (mode && ['system', 'light', 'dark'].includes(mode.value)) { theme.mode = mode.value as ThemeMode; save() }
    }
    const onHue = () => {
        if (!hue || !Number.isFinite(hue.valueAsNumber)) return
        theme.hue = Math.round(Math.max(0, Math.min(360, hue.valueAsNumber)))
        save()
    }
    const onReset = () => { theme = { ...DEFAULT_THEME }; save() }
    preset?.addEventListener(EVENT_CHANGE, onPreset)
    mode?.addEventListener(EVENT_CHANGE, onMode)
    hue?.addEventListener(EVENT_INPUT, onHue)
    reset?.addEventListener(EVENT_CLICK, onReset)
    render()
    return () => {
        preset?.removeEventListener(EVENT_CHANGE, onPreset)
        mode?.removeEventListener(EVENT_CHANGE, onMode)
        hue?.removeEventListener(EVENT_INPUT, onHue)
        reset?.removeEventListener(EVENT_CLICK, onReset)
    }
}
