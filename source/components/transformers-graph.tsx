import React from 'react'
import ReactDOM from 'react-dom/client';
import App from './graph/Graph'

export const createGraph = (el: string) => {
    
ReactDOM.createRoot(document.getElementById('graph')!).render(
    <App />
);
}