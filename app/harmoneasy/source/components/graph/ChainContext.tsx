import { createContext, useContext } from "react"
import type { ChainUIContext } from "./chain-ui-context"

export const ChainContext = createContext<ChainUIContext | null>(null)

export function useChain() {
	const value = useContext(ChainContext)
	if (!value) {
		throw new Error("Chain controls require a ChainContext")
	}
	return value
}