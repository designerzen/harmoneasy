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
	| "number"
	| "text"
	| "meter"
	| "display"
	| "color"
export interface ControlChoice {
	label: string
	value: ControlValue
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
	getUiDescriptor?(): UiDescriptor | Promise<UiDescriptor>
	getControlValue?(id: string): ControlValue | undefined | Promise<ControlValue | undefined>
	setControlValue?(id: string, value: ControlValue): void | Promise<void>
	subscribeControls?(listener: () => void): () => void
	createGui?(): HTMLElement | Promise<HTMLElement>
	destroyGui?(): void | Promise<void>
}
export interface ControlBinding {
	key: string
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
}
export interface SurfaceConnection {
	componentId: string
	controlIds: string[]
}
export interface SurfaceState {
	id: string
	name: string
	connections: SurfaceConnection[]
	widgets: SurfaceWidget[]
	theme?: "neon" | "amber" | "ice"
}