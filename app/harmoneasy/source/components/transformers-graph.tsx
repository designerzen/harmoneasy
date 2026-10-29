import React from "react"
import { createRoot } from "react-dom/client"
import Graph from "./graph/Graph"
import { createChainWorkspace } from "./graph/chain-workspace"
import type IOChainManager from "audiobus/io/IO-chain-manager"

export const createGraph = (elementID = "graph", ioManager: IOChainManager | null = null) => {
	const container = document.getElementById(elementID)
	if (!container) {
		throw Error("No element found to add graph to")
	}
	if (!ioManager) {
		throw Error("A chain manager is required to create the graph")
	}
	return createChainWorkspace(container, ioManager, (host, context) => {
		const root = createRoot(host)
		return {
			update(isFront, focusRequest) {
				root.render(<Graph {...context} isFront={isFront} focusRequest={focusRequest} />)
			},
			destroy() {
				root.unmount()
			}
		}
	})
}