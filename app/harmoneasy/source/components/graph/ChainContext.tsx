import { createContext, useContext } from 'react'
import type IOChain from 'audiobus/io/IO-chain'
import type IOChainManager from 'audiobus/io/IO-chain-manager'

export const ChainContext = createContext<{ chain: IOChain; chainId: string; manager: IOChainManager } | null>(null)

export function useChain() {
    const value = useContext(ChainContext)
    if (!value) throw new Error('Chain controls require a ChainContext')
    return value
}
