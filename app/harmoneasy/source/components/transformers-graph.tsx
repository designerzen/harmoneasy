import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './graph/Graph'
import type IOChainManager from 'audiobus/io/IO-chain-manager'

export const createGraph = (elementID: string = "graph", ioManager:IOChainManager=null ) => {
	const container = document.getElementById(elementID)
	
	if (container) {
		ReactDOM.createRoot(container).render(<App manager={ioManager} />)
	}else{
		throw Error("No element found to add graph to")
	}
}