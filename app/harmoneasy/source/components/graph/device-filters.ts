import type { DeviceClassification, DeviceAttribution } from "audiobus/io/device-classification"

export interface ClassifiedChoice extends DeviceClassification {
	id: string
	name: string
	description: string
	category?: string
	title?: string
	attribution?: DeviceAttribution
	preview?: string
}

const LABELS: Record<string, string> = {
	midi: "MIDI",
	ai: "AI",
	fm: "FM",
	eq: "EQ",
	wam2: "WAM2",
	supercollider: "SuperCollider",
	instrument: "Instruments",
	visualiser: "Visualisers"
}
export const classificationLabel = (value: string) =>
	LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1)

function category(choice: ClassifiedChoice): string {
	return choice.id === "supersonic" ? "supercollider" : (choice.category ?? "").toLowerCase()
}

export function choiceMatches(
	choice: ClassifiedChoice,
	search: string,
	selection: string
): boolean {
	const [field, value] = selection.split(":")
	const matchesSelection =
		!selection ||
		(field === "category"
			? category(choice) === value
			: field === "type"
				? choice.type === value
				: choice.subtype === value)
	return (
		matchesSelection &&
		[
			choice.name,
			choice.title,
			choice.description,
			choice.type,
			choice.subtype,
			category(choice),
			choice.attribution?.author,
			choice.attribution?.license
		]
			.join(" ")
			.toLowerCase()
			.includes(search.trim().toLowerCase())
	)
}

export function choiceFilterOptions(choices: ClassifiedChoice[]) {
	return (["type", "subtype", "category"] as const)
		.map((field) => ({
			label: field === "type" ? "Types" : field === "subtype" ? "Subtypes" : "Categories",
			options: [
				...new Set(
					choices.map((choice) =>
						field === "category" ? category(choice) : choice[field]
					)
				)
			]
				.filter(
					(value) =>
						value &&
						(field !== "category" ||
							!choices.some(
								(choice) => choice.type === value || choice.subtype === value
							))
				)
				.sort((a, b) => classificationLabel(a).localeCompare(classificationLabel(b)))
				.map((value) => ({ value: `${field}:${value}`, label: classificationLabel(value) }))
		}))
		.filter((group) => group.options.length)
}

export function groupChoices<T extends ClassifiedChoice>(choices: T[]) {
	const groups = new Map<string, { type: string; subtype: string; label: string; items: T[] }>()
	for (const choice of choices) {
		const key = `${choice.type}:${choice.subtype}`
		if (!groups.has(key)) {
			groups.set(key, {
				type: choice.type,
				subtype: choice.subtype,
				label: `${classificationLabel(choice.type)} / ${classificationLabel(choice.subtype)}`,
				items: []
			})
		}
		groups.get(key)!.items.push(choice)
	}
	return [...groups.values()]
		.sort((a, b) => a.label.localeCompare(b.label))
		.map((group) => ({
			...group,
			items: [...group.items].sort((a, b) => a.name.localeCompare(b.name))
		}))
}