// @vitest-environment happy-dom
import { expect, it, vi } from "vitest"
import { createClassificationFilter } from "../source/components/graph/ClassificationFilter"
import { choiceMatches, type ClassifiedChoice } from "../source/components/graph/device-filters"

const choices: ClassifiedChoice[] = [
	{
		id: "wam2:piano",
		name: "Piano",
		description: "Grand piano",
		type: "engine",
		subtype: "instrument",
		category: "Audio"
	},
	{
		id: "webclap:synth",
		name: "Synth",
		description: "Bass synthesizer",
		type: "engine",
		subtype: "instrument",
		category: "Audio"
	},
	{
		id: "webclap:delay",
		name: "Echo",
		description: "Stereo delay",
		type: "audio",
		subtype: "effect",
		category: "Audio"
	}
]

it("combines visible filters and search, with counts and unavailable options", () => {
	const onChange = vi.fn()
	const filter = createClassificationFilter({ choices, value: "", label: "Outputs", onChange })
	const selects = [...filter.element.querySelectorAll("select")]
	const [type, fn, category] = selects
	expect(selects.map((select) => select.getAttribute("aria-label"))).toEqual([
		"Outputs: Type",
		"Outputs: Function",
		"Outputs: Category"
	])
	fn.value = "subtype:instrument"
	fn.dispatchEvent(new Event("change"))
	category.value = "category:webclap"
	category.dispatchEvent(new Event("change"))
	const selection = onChange.mock.lastCall![0]
	expect(
		choices
			.filter((choice) => choiceMatches(choice, "", selection))
			.map((choice) => choice.name)
	).toEqual(["Synth"])
	expect(category.querySelector('option[value="category:webclap"]')!.textContent).toBe(
		"WebCLAP (1)"
	)
	expect(type.querySelector<HTMLOptionElement>('option[value="type:audio"]')!.disabled).toBe(true)
	filter.update(choices, "piano")
	expect(choices.filter((choice) => choiceMatches(choice, "piano", selection))).toEqual([])
	expect(category.value).toBe("category:webclap")
	expect(category.querySelector('option[value="category:webclap"]')!.textContent).toBe(
		"WebCLAP (0)"
	)
	expect(category.querySelector('option[value="category:wam2"]')!.textContent).toBe("WAM2 (1)")
	for (const select of selects) {
		expect(new Set([...select.options].map((option) => option.value)).size).toBe(
			select.options.length
		)
	}
	filter.clear()
	expect(selects.every((select) => select.value === "")).toBe(true)
	expect(onChange).toHaveBeenLastCalledWith("")
})

it("keeps initial selections through empty and refreshed catalogs", () => {
	const onChange = vi.fn()
	const filter = createClassificationFilter({
		choices: [],
		value: "subtype:instrument|category:wam2",
		label: "Outputs",
		onChange
	})
	filter.update(choices)
	const fn = filter.element.querySelector<HTMLSelectElement>('[aria-label="Outputs: Function"]')!
	const category = filter.element.querySelector<HTMLSelectElement>(
		'[aria-label="Outputs: Category"]'
	)!
	expect(fn.value).toBe("subtype:instrument")
	expect(category.value).toBe("category:wam2")
	filter.update([])
	expect(category.value).toBe("category:wam2")
	expect(category.selectedOptions[0].textContent).toBe("WAM2 (0)")
	expect(onChange).not.toHaveBeenCalled()
})