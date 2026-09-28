import React from 'react'
import { Controls, ControlButton, useReactFlow, useViewport } from '@xyflow/react'
import { DEFAULT_GRAPH_OPTIONS } from './options'

export function GraphControls({ layoutMode }: { layoutMode: string }) {
    const { zoomIn, zoomOut, fitView } = useReactFlow()
    const { zoom } = useViewport()
    return <Controls className="graph-view-controls" showZoom={false} showFitView={false}
        orientation={layoutMode === 'vertical' ? 'horizontal' : 'vertical'}>
        <ControlButton className="graph-zoom-in btn-zoom-in" title="Zoom in" aria-label="Zoom in"
            disabled={zoom >= DEFAULT_GRAPH_OPTIONS.maxZoom} onClick={() => void zoomIn({ duration: 150 })}>
            <span className="sr-only">Zoom in</span>
        </ControlButton>
        <ControlButton className="graph-zoom-out btn-zoom-out" title="Zoom out" aria-label="Zoom out"
            disabled={zoom <= DEFAULT_GRAPH_OPTIONS.minZoom} onClick={() => void zoomOut({ duration: 150 })}>
            <span className="sr-only">Zoom out</span>
        </ControlButton>
        <ControlButton className="graph-fit-all" title="Fit all inside viewport" aria-label="Fit all inside viewport"
            onClick={() => void fitView({ padding: .15, duration: 150, ...DEFAULT_GRAPH_OPTIONS })}>
            <svg className="graph-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="2" y="3" width="20" height="18" rx="2" />
                <path d="m5 6 4 4M6 10h3V7m10 11-4-4m0 3v-3h3" />
            </svg>
        </ControlButton>
    </Controls>
}
