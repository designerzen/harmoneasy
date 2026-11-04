export const DEFAULT_GRAPH_OPTIONS = {
	minZoom: 0.05,
	maxZoom: 1.5
}

// Opening a chain favours readable nodes; "Fit all" still shows everything.
export const READABLE_FIT_OPTIONS = {
	padding: 0.06,
	minZoom: 0.6,
	maxZoom: 1
}

export const FIT_TOP_MARGIN = 16

export const DEFAULT_VIEWPORT_OPTIONS = {
	x: 0,
	y: 0,
	zoom: 0.8
}

// Calculate positions with better spacing and centering
export const HORIZONTAL_SPACING = 373
export const NODE_HEIGHT = 323

export const LAYOUT_MODE = {
	horizontal: "horizontal",
	vertical: "vertical"
}

export const DEFAULT_LAYOUT_MODE = LAYOUT_MODE.vertical