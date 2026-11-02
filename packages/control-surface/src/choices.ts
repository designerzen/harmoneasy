import type { ControlChoice, ControlDescriptor, WidgetType } from "./types"

/** Small choice lists use radios, including surfaces saved with select widgets. */
export function choiceWidget(d: ControlDescriptor): WidgetType {
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