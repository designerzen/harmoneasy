import type {
	ControlDescriptor,
	ControlValue,
	DialOptions,
	SurfaceState,
	WidgetType
} from "./types"
import { isMusicGrid, musicOptions, musicValues } from "./music"
import { strumOptions } from "./strum"

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
	"color",
	"rotation",
	"guitar-tab",
	"piano-roll",
	"relative-keys",
	"strum"
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
		if (
			!Array.isArray(value) ||
			value.length !== steps * pitches.length ||
			!value.every(Number.isFinite)
		) {
			throw new Error(`${d.label} requires ${steps * pitches.length} finite cell values`)
		}
		return musicValues(d, value)
	}
	if (d.widget === "relative-keys") {
		if (
			!Array.isArray(value) ||
			!value.every(Number.isFinite) ||
			(value.length !== 0 &&
				(value.length < 7 || (value.length - 2) % 5 !== 0 || value.length > 82))
		) {
			throw new Error(`${d.label} requires relative key contacts`)
		}
		if (value.length) {
			if (value[0] < 0 || value[0] > 1 || value[1] < 0 || value[1] > 1) {
				throw new RangeError("Invalid touch anchor")
			}
			const ids = new Set<number>()
			for (let i = 2; i < value.length; i += 5) {
				if (
					!Number.isInteger(value[i]) ||
					ids.has(value[i]) ||
					!Number.isInteger(value[i + 1]) ||
					value[i + 1] < 0 ||
					value[i + 1] > 127 ||
					value[i + 2] < 0 ||
					value[i + 2] > 1 ||
					value[i + 3] < 0 ||
					value[i + 3] > 1 ||
					value[i + 4] < 0 ||
					value[i + 4] > 1
				) {
					throw new RangeError("Invalid relative key contact")
				}
				ids.add(value[i])
			}
		}
		return [...value]
	}
	if (d.widget === "strum") {
		const { tuning } = strumOptions(d.strum)
		if (
			!Array.isArray(value) ||
			!value.every(Number.isFinite) ||
			(value.length !== 0 &&
				(value.length !== 4 ||
					!Number.isSafeInteger(value[0]) ||
					value[0] < 1 ||
					!Number.isInteger(value[1]) ||
					value[1] < 0 ||
					value[1] >= tuning.length ||
					!Number.isInteger(value[2]) ||
					value[2] < 0 ||
					value[2] > 127 ||
					value[3] <= 0 ||
					value[3] > 1))
		) {
			throw new Error(`${d.label} requires a strum event`)
		}
		return [...value]
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
	if (["dial", "slider", "number", "pad"].includes(d.widget)) {
		return ["dial", "slider", "number", "pad"]
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
			(s.beatCues === undefined || typeof s.beatCues === "boolean") &&
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
					(w.height === undefined ||
						(Number.isInteger(w.height) && w.height >= 132 && w.height <= 720)) &&
					(w.rotation === undefined || [0, 90, 180, 270].includes(w.rotation)) &&
					(w.column === undefined ||
						(Number.isInteger(w.column) && w.column >= 0 && w.column <= 31)) &&
					(w.dial === undefined || validDialOptions(w.dial))
			)
		)
	})
}

export { layoutWidgets, ergonomicOrder, playingLayout } from "./layout"

/** Convert a surface/XR hit to the widget's unrotated coordinates. */
export function widgetPoint(
	x: number,
	y: number,
	rect: { x: number; y: number; width: number; height: number; rotation?: number }
) {
	const angle = (-(rect.rotation ?? 0) * Math.PI) / 180
	const cx = rect.x + rect.width / 2,
		cy = rect.y + rect.height / 2
	return {
		x: cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
		y: cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)
	}
}