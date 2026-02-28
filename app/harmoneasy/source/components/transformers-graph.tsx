import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './graph/Graph'

export const createGraph = (elementID: string = "graph") => {
	const container = document.getElementById(elementID)
	if (container) {
		ReactDOM.createRoot(container).render(<App />)
	}else{
		throw Error("No element found to add graph to")
	}
}