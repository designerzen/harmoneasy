import { createPresetBrowser } from '../components/graph/PresetBrowser'
import { presetSetup } from '../components/graph/preset-catalogue'
import type { PresetSetup } from 'audiobus/io/preset-library'
export * from './start-context-catalogue'

export function createStartContexts(root: HTMLElement, onStart?: (setup: PresetSetup) => void | Promise<void>) {
    let selected: PresetSetup | undefined
    const host = root.querySelector<HTMLElement>('.start-presets-content')!
    host.replaceChildren()
    const choose = (setup: PresetSetup) => {
        selected = setup
        return onStart?.(setup)
    }
    const browser = createPresetBrowser({
        createChain: true,
        startup: true,
        onChooseSetup: choose,
        onApply: preset => choose(presetSetup(preset))
    })
    host.append(browser.element)
    return { getSetup: () => selected, destroy: () => browser.destroy() }
}
