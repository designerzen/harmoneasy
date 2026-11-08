export type ControlValue = string | number | boolean | number[]
export type WidgetType =
	| "dial"
	| "slider"
	| "toggle"
	| "radio"
	| "select"
	| "xy"
	| "envelope"
	| "range"
	| "button"
	| "pad"
	| "number"
	| "text"
	| "meter"
	| "display"
	| "color"
	| "rotation"
	| "guitar-tab"
	| "piano-roll"
	| "relative-keys"
	| "strum"
	| "visualiser"
export type VisualiserKind = "notes" | "waveform" | "spectrum" | "level" | "history"
export interface SurfaceVisualiser {
	sourceId: string
	kind: VisualiserKind
	opacity?: number
}
export interface VisualiserSource {
	/** Component identity used to share its gadget theme. */
	sourceId?: string
	id: string
	label: string
	kinds: VisualiserKind[]
	/** Reuse buffers where possible. Samples are signed for waveform, otherwise normalized 0..1. */
	read(kind: VisualiserKind): { samples: ArrayLike<number>; level: number } | undefined
}
export interface StrumOptions {
	tuning?: number[]
	frets?: number[]
	/** Maximum ring time in milliseconds for live output bindings. */
	duration?: number
}
export interface RelativeKeysOptions {
	rootNote?: number
	horizontalInterval?: number
	verticalInterval?: number
	keySize?: number
}
/** Row-major sequence data: piano velocities 0..1; tab frets -1 (rest)..frets. */
export interface MusicGridOptions {
	/** Live note gates release on blur/removal; sequence editors retain their data. */
	live?: boolean
	steps?: number
	/** Piano MIDI pitches from top to bottom. */
	notes?: number[]
	/** Guitar MIDI tuning from top string to bottom string. */
	tuning?: number[]
	frets?: number
}
export interface ControlChoice {
	label: string
	value: ControlValue
}
/** Procedural geometry and interaction options for component/widget authors. */
export interface DialOptions {
	mode?: "level" | "pan" | "rotation"
	input?: "vertical" | "angular"
	startAngle?: number
	sweepAngle?: number
	reverse?: boolean
	centerDetent?: boolean
	ticks?: number
	tickDirection?: "inward" | "outward" | "both"
}
/** Procedural art direction; values are independent of control response. */
export interface SurfaceVisualEffects {
	bloom?: number
	bloomRadius?: number
	depth?: number
	scanlines?: number
}
/** Serializable description; no DOM, engine resources, or callbacks. */
export interface ControlDescriptor {
	id: string
	label: string
	widget: WidgetType
	group?: string
	help?: string
	/** Name from CONTROL_ICONS; inferred from the id and label when omitted. */
	icon?: string
	/** 0..1 performance importance used when filling a surface automatically. */
	priority?: number
	defaultValue?: ControlValue
	min?: number
	max?: number
	step?: number
	unit?: string
	scale?: "linear" | "log"
	/** Compound ADSR: [attack seconds, decay seconds, sustain 0..1, release seconds]. */
	envelope?: { attackMax?: number; decayMax?: number; releaseMax?: number }
	dial?: DialOptions
	/** MIDI note used for the pad light; defaults to middle C. */
	pad?: { note?: number }
	visualiser?: SurfaceVisualiser
	music?: MusicGridOptions
	relativeKeys?: RelativeKeysOptions
	strum?: StrumOptions
	choices?: ControlChoice[]
	readOnly?: boolean
	disabled?: boolean
	hidden?: boolean
}
export interface UiDescriptor {
	controls: ControlDescriptor[]
	title?: string
}
export interface ComponentUi {
	createSurfaceView?(): { element: HTMLElement; destroy(): void }
	getUiDescriptor?(): UiDescriptor | Promise<UiDescriptor>
	getControlValue?(id: string): ControlValue | undefined | Promise<ControlValue | undefined>
	setControlValue?(id: string, value: ControlValue): void | Promise<void>
	subscribeControls?(listener: () => void): () => void
	createGui?(): HTMLElement | Promise<HTMLElement>
	destroyGui?(): void | Promise<void>
}
export interface ControlBinding {
	key: string
	/** Stable component identity; controls from one source share an art direction. */
	sourceId?: string
	sourceLabel: string
	descriptor: ControlDescriptor
	read(): ControlValue | undefined | Promise<ControlValue | undefined>
	write(value: ControlValue): void | Promise<void>
	subscribe?(listener: () => void): () => void
}
/** A key or MIDI message reserved for one gadget; matching events never reach instruments. */
export interface SurfaceTrigger {
	/** KeyboardEvent.key, lower-cased for single characters. */
	key?: string
	/** Channel 0 matches every channel. */
	midi?: { type: "note" | "cc"; number: number; channel: number }
}
export interface SurfaceWidget {
	visualiser?: SurfaceVisualiser
	/** Hardware trigger for buttons, toggles and pads. */
	trigger?: SurfaceTrigger
	key: string
	yKey?: string
	widget?: WidgetType
	span?: number
	/** Height in CSS pixels, independent of width. */
	height?: number
	rotation?: 0 | 90 | 180 | 270
	/** Optional preferred column; packing moves neighbours to prevent collisions. */
	column?: number
	/** Optional override for programmatically authored surfaces. */
	dial?: DialOptions
}
export interface SurfaceConnection {
	componentId: string
	controlIds: string[]
}
export interface SurfaceState {
	background?: SurfaceVisualiser | null
	visualisersPaused?: boolean
	beatCues?: boolean
	panels?: string[]
	id: string
	name: string
	connections: SurfaceConnection[]
	widgets: SurfaceWidget[]
	theme?: "neon" | "amber" | "ice"
}
/** Actions supplied by the application to the surface's single settings popup. */
export interface SurfaceMenuAction {
	label: string
	icon?: string
	className?: string
	editOnly?: boolean
	action(): void
}