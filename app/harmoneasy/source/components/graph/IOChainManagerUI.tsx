import React, { useState, useEffect } from "react"
import type IOChainManager from "audiobus/io/IO-chain-manager"

const EVENT_CHAINS_UPDATED = "chainsUpdated"
const EVENT_CHAIN_ACTIVE_CHANGED = "chainActiveChanged"

interface ChainStatus {
    id: string
    isActive: boolean
    inputCount: number
    outputCount: number
    transformerCount: number
    commandQueueLength: number
}

export function IOChainManagerUI() {
    const [ioManager, setIoManager] = useState<IOChainManager | null>(null)
    const [chainStatuses, setChainStatuses] = useState<ChainStatus[]>([])

    useEffect(() => {
        const manager = (window as any).ioManager as IOChainManager
        if (!manager) return

        setIoManager(manager)
        updateChainStatuses(manager)

        const onChainsUpdated = () => {
            updateChainStatuses(manager)
        }

        manager.addEventListener(EVENT_CHAINS_UPDATED, onChainsUpdated)
        manager.addEventListener(EVENT_CHAIN_ACTIVE_CHANGED, onChainsUpdated)

        return () => {
            manager.removeEventListener(EVENT_CHAINS_UPDATED, onChainsUpdated)
            manager.removeEventListener(EVENT_CHAIN_ACTIVE_CHANGED, onChainsUpdated)
        }
    }, [])

    const updateChainStatuses = (manager: IOChainManager) => {
        const statuses = manager.getStatus()
        setChainStatuses(statuses)
    }

    const handleAddChain = async () => {
        if (!ioManager) return
        await ioManager.createDefaultChain()
    }

    const handleRemoveChain = async (chainId: string) => {
        if (!ioManager) return

        if (ioManager.chainCount <= 1) {
            alert("Cannot remove the last chain. At least one chain is required.")
            return
        }

        if (confirm(`Are you sure you want to remove this IOChain?`)) {
            ioManager.removeChain(chainId)
        }
    }

    const handleSwitchChain = (chainId: string) => {
        if (!ioManager) return

        ioManager.setActiveChain(chainId)
        const chain = ioManager.getChain(chainId)
        if (chain) {
            ;(window as any).chain = chain
        }
    }

    return (
        <details className="iochain-manager">
            <summary>IOChains</summary>

            <div className="iochain-actions">
                <button
                    type="button"
                    className="btn-add-chain"
                    onClick={handleAddChain}
                    title="Add a new IOChain"
                >
                    + Add IOChain
                </button>
            </div>

            <ul className="chain-list" role="list">
                {chainStatuses.map((status, index) => (
                    <li key={status.id} className={`chain-item ${status.isActive ? 'active' : ''}`}>
                        <button
                            type="button"
                            className="btn-switch-chain"
                            onClick={() => handleSwitchChain(status.id)}
                            title={status.isActive ? 'Currently active' : 'Switch to this chain'}
                        >
                            {status.isActive ? `Chain ${index + 1} (Active)` : `Chain ${index + 1}`}
                        </button>
                        {chainStatuses.length > 1 && (
                            <button
                                type="button"
                                className="btn-remove-chain"
                                onClick={() => handleRemoveChain(status.id)}
                                title="Remove this IOChain"
                                disabled={status.isActive}
                            >
                                ✕
                            </button>
                        )}
                    </li>
                ))}
            </ul>

            {chainStatuses.length === 0 && (
                <p className="no-chains">No IOChains available</p>
            )}
        </details>
    )
}
