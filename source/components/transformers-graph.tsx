import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './graph/Graph'

export const createGraph = (elementID: string="graph") => {
	ReactDOM.createRoot(document.getElementById(elementID)!).render(<App />)
}