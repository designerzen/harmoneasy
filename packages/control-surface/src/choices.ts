import type { ControlChoice, ControlDescriptor, WidgetType } from "./types"

/** Performance controls never require opening a picker or typing a numeric value. */
export function directDescriptor(d: ControlDescriptor): ControlDescriptor {
	if (d.choices?.length && d.choices.every(choice => typeof choice.value === "number")) {
		return { ...d, widget: "radio" }
	}
	if (d.widget !== "number") { return d }
	const step = d.step ?? 1, min = d.min, max = d.max
	if (Number.isInteger(min) && Number.isInteger(max) && Number.isInteger(step) && step > 0 && max! >= min!) {
		const count = Math.floor((max! - min!) / step) + 1
		if (count <= 128) {
			return { ...d, widget: "radio", choices: Array.from({ length: count }, (_, index) => {
				const value = min! + index * step
				return { label: String(value), value }
			}) }
		}
	}
	return { ...d, widget: "slider", step }
}

/** Small choice lists use radios, including surfaces saved with select widgets. */
export function choiceWidget(d: ControlDescriptor): WidgetType {
	d = directDescriptor(d)
	return d.widget === "select" && d.choices && d.choices.length > 1 && d.choices.length < 7
		? "radio"
		: d.widget
}

export function choiceGrid(count: number): { columns: number; rows: number } {
	const columns = Math.min(count, count <= 4 ? 2 : 3)
	return { columns, rows: Math.ceil(count / Math.max(1, columns)) }
}

/** Shared normalized paths keep DOM and GPU waveform icons identical. */
export function waveformPoints(choice: ControlChoice): number[][] | undefined {
	const shape = String(choice.value).toLowerCase()
	if (shape === "sine") {
		return Array.from({ length: 33 }, (_, i) => [
			i / 32,
			0.5 - Math.sin((i / 32) * Math.PI * 2) * 0.4
		])
	}
	if (shape === "square")
		return [
			[0, 0.9],
			[0, 0.1],
			[0.5, 0.1],
			[0.5, 0.9],
			[1, 0.9],
			[1, 0.1]
		]
	if (shape === "triangle")
		return [
			[0, 0.5],
			[0.25, 0.1],
			[0.75, 0.9],
			[1, 0.5]
		]
	if (shape === "sawtooth" || shape === "ramp")
		return [
			[0, 0.9],
			[0.5, 0.1],
			[0.5, 0.9],
			[1, 0.1]
		]
	return undefined
}
