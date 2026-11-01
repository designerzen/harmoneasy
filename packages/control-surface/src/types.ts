export type ControlValue = string | number | boolean | number[]
export type WidgetType =
	| "dial"
	| "slider"
	| "toggle"
	| "radio"
	| "select"
	| "xy"
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
	defaultValue?: ControlValue
	min?: number
	max?: number
	step?: number
	unit?: string
	scale?: "linear" | "log"
	dial?: DialOptions
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
export interface SurfaceWidget {
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
	beatCues?: boolean
	panels?: string[]
	id: string
	name: string
	connections: SurfaceConnection[]
	widgets: SurfaceWidget[]
	theme?: "neon" | "amber" | "ice"
}