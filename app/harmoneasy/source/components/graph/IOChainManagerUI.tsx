import React, { useRef } from 'react'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { applyPreset } from './saved-presets'
import { PresetBrowser } from './PresetBrowser'
import { presetContext } from './preset-catalogue'

export function IOChainManagerUI({ manager }: { manager: IOChainManager }) {
    const adding = useRef(false)
    return <PresetBrowser createChain onApply={async preset => {
        if (adding.current) return
        adding.current = true
        try {
            const context = presetContext(preset)
            const id = context ? await manager.createChainWithSounds(context.outputs ?? [{ factory: 'polyphonic' }]) : await manager.createDefaultChain()
            const chain = manager.getChain(id)!
            if (preset.id) {
                applyPreset(chain, preset)
                chain.setName(preset.name)
            }
            manager.setActiveChain(id)
        } finally { adding.current = false }
    }} />
}
