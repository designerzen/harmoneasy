import React from 'react'
import { createRoot } from 'react-dom/client'
import { PresetBrowser } from '../components/graph/PresetBrowser'
import { presetSetup } from '../components/graph/preset-catalogue'
import type { PresetSetup } from 'audiobus/io/preset-library'
export * from './start-context-catalogue'

export function createStartContexts(root: HTMLElement) {
    let selected: PresetSetup | undefined
    const host = root.querySelector<HTMLElement>('.start-presets-content')!
    host.replaceChildren()
    const choose = (setup: PresetSetup) => {
        selected = setup
        root.querySelector<HTMLElement>('#start-context-selection')!.textContent = `${setup.name} — ready to start.`
        root.querySelector<HTMLButtonElement>('.btn-start-preset')!.disabled = false
    }
    createRoot(host).render(React.createElement(PresetBrowser, {
        createChain: true,
        startup: true,
        onChooseSetup: choose,
        onApply: preset => choose(presetSetup(preset))
    }))
    return { getSetup: () => selected }
}
