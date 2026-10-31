import type { ControlDescriptor, ControlValue, SurfaceState, WidgetType } from "./types"

export const WIDGET_TYPES: WidgetType[] = [
	"dial",
	"slider",
	"toggle",
	"radio",
	"select",
	"xy",
	"range",
	"button",
	"number",
	"text",
	"meter",
	"display",
	"color"
]
export const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v))
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
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
	if (["dial", "slider", "number"].includes(d.widget)) {
		return ["dial", "slider", "number"]
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
					(w.span === undefined || [1, 2, 3].includes(w.span))
			)
		)
	})
}

export function layoutWidgets(widgets: { span?: number }[], width: number) {
	const columns = Math.max(1, Math.floor(width / 200)),
		cell = width / columns,
		gap = 8
	let column = 0,
		row = 0
	const items = widgets.map((widget) => {
		const span = Math.min(columns, widget.span ?? 1)
		if (column + span > columns) {
			column = 0
			row++
		}
		const rect = { x: column * cell, y: row * 180, width: cell * span - gap, height: 172 }
		column += span
		return rect
	})
	return { items, height: widgets.length ? (row + 1) * 180 : 120 }
}