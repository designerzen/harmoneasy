import type {
	ControlDescriptor,
	ControlValue,
	DialOptions,
	SurfaceState,
	WidgetType
} from "./types"
import { isMusicGrid, musicOptions, musicValues } from "./music"

export function dialOptions(options: DialOptions = {}): Required<DialOptions> {
	const mode = options.mode ?? "level"
	return {
		mode,
		input: options.input ?? (mode === "rotation" ? "angular" : "vertical"),
		startAngle: options.startAngle ?? (mode === "rotation" ? 0 : mode === "pan" ? -90 : -135),
		sweepAngle: options.sweepAngle ?? (mode === "rotation" ? 360 : mode === "pan" ? 180 : 270),
		reverse: options.reverse ?? false,
		centerDetent: options.centerDetent ?? mode === "pan",
		ticks: options.ticks ?? 0,
		tickDirection: options.tickDirection ?? "outward"
	}
}
export function validDialOptions(value: unknown): value is DialOptions {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false
	}
	const d = value as DialOptions
	return (
		(d.mode === undefined || ["level", "pan", "rotation"].includes(d.mode)) &&
		(d.input === undefined || ["vertical", "angular"].includes(d.input)) &&
		(d.tickDirection === undefined ||
			["inward", "outward", "both"].includes(d.tickDirection)) &&
		(d.reverse === undefined || typeof d.reverse === "boolean") &&
		(d.centerDetent === undefined || typeof d.centerDetent === "boolean") &&
		(d.startAngle === undefined ||
			(Number.isFinite(d.startAngle) && d.startAngle >= -360 && d.startAngle <= 360)) &&
		(d.sweepAngle === undefined ||
			(Number.isFinite(d.sweepAngle) && d.sweepAngle >= 30 && d.sweepAngle <= 360)) &&
		(d.ticks === undefined || (Number.isInteger(d.ticks) && d.ticks >= 0 && d.ticks <= 48))
	)
}
export function dialPosition(position: number, options: Required<DialOptions>): number {
	const bounded = options.mode === "rotation" ? ((position % 1) + 1) % 1 : clamp(position)
	return options.centerDetent && Math.abs(bounded - 0.5) <= 0.0125 ? 0.5 : bounded
}

export const WIDGET_TYPES: WidgetType[] = [
	"dial",
	"slider",
	"toggle",
	"radio",
	"select",
	"xy",
	"range",
	"button",
	"pad",
	"number",
	"text",
	"meter",
	"display",
	"color"
	,"rotation", "guitar-tab", "piano-roll"
]
export const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v))
export const sameValue = (a: unknown, b: unknown) =>
	Object.is(a, b) ||
	(Array.isArray(a) &&
		Array.isArray(b) &&
		a.length === b.length &&
		a.every((value, index) => Object.is(value, b[index])))
export function bounds(d: ControlDescriptor): [number, number] {
	const min = d.min ?? 0,
		max = d.max ?? 1
	return [min, Math.max(min, max)]
}
export function normalize(d: ControlDescriptor, value: number): number {
	const [min, max] = bounds(d)
	if (min === max || !Number.isFinite(value)) {
		return 0
	}
	return clamp(
		d.scale === "log" && min > 0
			? Math.log(Math.max(min, value) / min) / Math.log(max / min)
			: (value - min) / (max - min)
	)
}
export function denormalize(d: ControlDescriptor, position: number): number {
	const [min, max] = bounds(d),
		t = clamp(position)
	const value = d.scale === "log" && min > 0 ? min * (max / min) ** t : min + (max - min) * t
	const step = d.step ?? 0
	return clamp(
		Number((step > 0 ? min + Math.round((value - min) / step) * step : value).toPrecision(12)),
		min,
		max
	)
}
export function validateValue(d: ControlDescriptor, value: ControlValue): ControlValue {
	if (d.readOnly || d.disabled) {
		throw new Error(`${d.label} is unavailable`)
	}
	if (d.widget === "button") {
		return value
	}
	if (isMusicGrid(d.widget)) {
		const { steps, pitches } = musicOptions(d.widget, d.music)
		if (!Array.isArray(value) || value.length !== steps * pitches.length || !value.every(Number.isFinite)) {
			throw new Error(`${d.label} requires ${steps * pitches.length} finite cell values`)
		}
		return musicValues(d, value)
	}
	if (d.choices?.length) {
		const choice = d.choices.find((c) => sameValue(c.value, value))
		if (!choice) {
			throw new Error(`Choose a valid ${d.label}`)
		}
		return choice.value
	}
	if (d.widget === "toggle") {
		if (typeof value !== "boolean") {
			throw new Error(`${d.label} requires a boolean`)
		}
		return value
	}
	if (d.widget === "xy" || d.widget === "range") {
		if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
			throw new Error(`${d.label} requires two numbers`)
		}
		const values = value.map((v) => denormalize(d, normalize(d, v)))
		return d.widget === "range" ? values.sort((a, b) => a - b) : values
	}
	if (["text", "color"].includes(d.widget)) {
		if (typeof value !== "string") {
			throw new Error(`${d.label} requires text`)
		}
		if (d.widget === "color" && !/^#[\da-f]{6}$/i.test(value)) {
			throw new Error("Choose a valid colour")
		}
		return value
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${d.label} requires a finite number`)
	}
	return denormalize(d, normalize(d, value))
}
export function widgetChoices(d: ControlDescriptor): WidgetType[] {
	if (d.choices?.length) {
		return ["radio", "select"]
	}
	if (["dial", "rotation", "slider", "number", "pad"].includes(d.widget)) {
		return ["dial", "rotation", "slider", "number", "pad"]
	}
	return [d.widget]
}
export function formatValue(d: ControlDescriptor, value: ControlValue | undefined): string {
	const choice = d.choices?.find((c) => sameValue(c.value, value))
	if (choice) {
		return choice.label
	}
	if (typeof value === "number") {
		return `${Number(value.toFixed(3))}${d.unit ? ` ${d.unit}` : ""}`
	}
	if (typeof value === "boolean") {
		return value ? "On" : "Off"
	}
	if (Array.isArray(value)) {
		return value.map((v) => Number(v.toFixed(3))).join(" / ")
	}
	return value ?? "—"
}
export function bindingKey(componentId: string, controlId: string): string {
	return JSON.stringify([componentId, controlId])
}
/** Validate untrusted workspace data before it can allocate widgets or bind devices. */
export function validSurfaces(value: unknown): value is SurfaceState[] {
	if (!Array.isArray(value) || value.length > 32) {
		return false
	}
	const ids = new Set<string>()
	return value.every((s) => {
		if (
			!s ||
			typeof s.id !== "string" ||
			!s.id ||
			ids.has(s.id) ||
			typeof s.name !== "string" ||
			s.name.length > 100
		) {
			return false
		}
		ids.add(s.id)
		return (
			(s.panels === undefined ||
				(Array.isArray(s.panels) &&
					s.panels.length <= 32 &&
					s.panels.every((id: unknown) => typeof id === "string"))) &&
			(!s.theme || ["neon", "amber", "ice"].includes(s.theme)) &&
			Array.isArray(s.connections) &&
			s.connections.length <= 256 &&
			s.connections.every(
				(c: any) =>
					c &&
					typeof c.componentId === "string" &&
					Array.isArray(c.controlIds) &&
					c.controlIds.length <= 512 &&
					c.controlIds.every((id: unknown) => typeof id === "string")
			) &&
			new Set(s.connections.map((c: any) => c.componentId)).size === s.connections.length &&
			Array.isArray(s.widgets) &&
			s.widgets.length <= 2048 &&
			s.widgets.every(
				(w: any) =>
					w &&
					typeof w.key === "string" &&
					(w.yKey === undefined || typeof w.yKey === "string") &&
					(!w.widget || WIDGET_TYPES.includes(w.widget)) &&
					(w.span === undefined || [1, 2, 3].includes(w.span)) &&
					(w.height === undefined || (Number.isInteger(w.height) && w.height >= 132 && w.height <= 720)) &&
					(w.dial === undefined || validDialOptions(w.dial))
			)
		)
	})
}

export function layoutWidgets(widgets: { span?: number; height?: number }[], width: number) {
	const columns = Math.max(1, Math.floor(width / 200)),
		cell = width / columns,
		gap = 8
	let column = 0,
		y = 0,
		rowHeight = 0
	const items = widgets.map((widget) => {
		const span = Math.min(columns, widget.span ?? 1)
		if (column + span > columns) {
			column = 0
			y += rowHeight + gap
			rowHeight = 0
		}
		const height = Math.max(132, Math.min(720, widget.height ?? 172))
		const rect = { x: column * cell, y, width: cell * span - gap, height }
		rowHeight = Math.max(rowHeight, height)
		column += span
		return rect
	})
	return { items, height: widgets.length ? y + rowHeight + gap : 120 }
}
