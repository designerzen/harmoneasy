import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './graph/Graph'
import type IOChainManager from 'audiobus/io/IO-chain-manager'

export const createGraph = (elementID: string = "graph", ioManager:IOChainManager=null ) => {
	const container = document.getElementById(elementID)
	
	// Expose to global 
	globalThis.ioManager = window.ioManager = ioManager
	globalThis.chain = window.chain = ioManager.chains[0]
	
	if (container) {
		ReactDOM.createRoot(container).render(<App />)
	}else{
		throw Error("No element found to add graph to")
	}
}