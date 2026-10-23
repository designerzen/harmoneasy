import React, { useRef } from 'react'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { applyPreset } from './saved-presets'
import { PresetBrowser } from './PresetBrowser'

export function IOChainManagerUI({ manager }: { manager: IOChainManager }) {
    const adding = useRef(false)
    return <PresetBrowser createChain onApply={async preset => {
        if (adding.current) return
        adding.current = true
        try {
            const id = await manager.createDefaultChain()
            const chain = manager.getChain(id)!
            if (preset.id) {
                applyPreset(chain, preset)
                chain.setName(preset.name)
            }
            manager.setActiveChain(id)
        } finally { adding.current = false }
    }} />
}
