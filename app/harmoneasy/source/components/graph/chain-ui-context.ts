import type IOChain from "audiobus/io/IO-chain"
import type IOChainManager from "audiobus/io/IO-chain-manager"

export interface ChainUIContext {
	chain: IOChain
	chainId: string
	manager: IOChainManager
}