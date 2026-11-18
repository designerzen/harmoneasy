import type { DeviceClassification, DeviceAttribution } from "audiobus/io/device-classification"
import { discoveryMatches } from "./discovery-search"

export interface ClassifiedChoice extends DeviceClassification {
	id: string
	name: string
	description: string
	category?: string
	title?: string
	attribution?: DeviceAttribution
	preview?: string
	keywords?: string
}

const LABELS: Record<string, string> = {
	midi: "MIDI",
	ai: "AI",
	fm: "FM",
	eq: "EQ",
	wam2: "WAM2",
	webclap: "WebCLAP",
	engine: "Sound engines",
	effect: "Effects",
	supercollider: "SuperCollider",
	instrument: "Instruments",
	visualiser: "Visualisers"
}
export const classificationLabel = (value: string) =>
	LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1)

function category(choice: ClassifiedChoice): string {
	if (choice.id === "wam2" || choice.id.startsWith("wam2:")) {
		return "wam2"
	}
	if (choice.id.startsWith("webclap:")) {
		return "webclap"
	}
	return choice.id === "supersonic" ? "supercollider" : (choice.category ?? "").toLowerCase()
}

export const FILTER_FIELDS = ["type", "subtype", "category"] as const
export type FilterField = (typeof FILTER_FIELDS)[number]

export function parseChoiceFilters(selection: string): Partial<Record<FilterField, string>> {
	return Object.fromEntries(
		selection
			.split("|")
			.map((entry) => entry.split(":"))
			.filter(
				([field, value]) => FILTER_FIELDS.includes(field as FilterField) && Boolean(value)
			)
	)
}

export function choiceMatches(
	choice: ClassifiedChoice,
	search: string,
	selection: string
): boolean {
	const matchesSelection = Object.entries(parseChoiceFilters(selection)).every(
		([field, value]) =>
			(field === "category" ? category(choice) : choice[field as FilterField]) === value
	)
	return (
		matchesSelection &&
		discoveryMatches(
			search,
			choice.id,
			choice.keywords,
			choice.name,
			choice.title,
			choice.description,
			choice.type,
			choice.subtype,
			category(choice),
			choice.attribution?.author,
			choice.attribution?.license
		)
	)
}

export function choiceFilterOptions(choices: ClassifiedChoice[], selection = "", search = "") {
	const selected = parseChoiceFilters(selection)
	return FILTER_FIELDS.map((field) => ({
		field,
		label: field === "type" ? "Type" : field === "subtype" ? "Function" : "Category",
		options: [
			...new Set([
				selected[field],
				...choices.map((choice) =>
					field === "category" ? category(choice) : choice[field]
				)
			])
		]
			.filter(
				(value) =>
					value &&
					(field !== "category" ||
						!choices.some(
							(choice) => choice.type === value || choice.subtype === value
						))
			)
			.sort((a, b) => classificationLabel(a!).localeCompare(classificationLabel(b!)))
			.map((value) => {
				const otherFilters = Object.entries(selected).filter(([key]) => key !== field)
				return {
					value: `${field}:${value}`,
					label: classificationLabel(value!),
					count: choices.filter((choice) =>
						choiceMatches(
							choice,
							search,
							[
								...otherFilters.map(([key, item]) => `${key}:${item}`),
								`${field}:${value}`
							].join("|")
						)
					).length
				}
			})
	})).filter((group) => group.options.length)
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