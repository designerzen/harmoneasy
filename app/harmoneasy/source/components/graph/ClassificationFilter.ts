import {
	choiceFilterOptions,
	parseChoiceFilters,
	FILTER_FIELDS,
	type FilterField,
	type ClassifiedChoice
} from "./device-filters"
import { element, option } from "./dom"

export function createClassificationFilter({
	choices,
	value,
	onChange,
	label
}: {
	choices: ClassifiedChoice[]
	value: string
	onChange: (value: string) => void
	label: string
}) {
	const host = element("div", "classification-filter")
	host.setAttribute("role", "group")
	host.setAttribute("aria-label", label)
	const selected = parseChoiceFilters(value)
	let items = choices
	let search = ""
	const controls = new Map<FilterField, { label: HTMLLabelElement; select: HTMLSelectElement }>()
	const selection = () =>
		FILTER_FIELDS.filter((field) => selected[field])
			.map((field) => `${field}:${selected[field]}`)
			.join("|")
	for (const field of FILTER_FIELDS) {
		const wrapper = element("label")
		const select = element("select")
		select.onchange = () => {
			selected[field] = select.value.split(":")[1] || undefined
			update(items, search)
			onChange(selection())
		}
		wrapper.append(element("span"), select)
		host.append(wrapper)
		controls.set(field, { label: wrapper, select })
	}
	function update(nextItems: ClassifiedChoice[], nextSearch = "") {
		items = nextItems
		search = nextSearch
		const groups = choiceFilterOptions(items, selection(), search)
		for (const [field, control] of controls) {
			const group = groups.find((group) => group.field === field)
			control.label.hidden = !group
			if (!group) {
				continue
			}
			control.label.querySelector("span")!.textContent = group.label
			control.select.setAttribute("aria-label", `${label}: ${group.label}`)
			const allLabel =
				field === "category"
					? "All categories"
					: field === "subtype"
						? "All functions"
						: "All types"
			control.select.replaceChildren(option(allLabel, ""))
			for (const item of group.options) {
				const node = option(`${item.label} (${item.count})`, item.value)
				node.disabled = item.count === 0 && selected[field] !== item.value.split(":")[1]
				control.select.append(node)
			}
			control.select.value = selected[field] ? `${field}:${selected[field]}` : ""
			control.select.dataset.active = String(Boolean(selected[field]))
		}
	}
	update(choices)
	return {
		element: host,
		update,
		clear() {
			for (const field of FILTER_FIELDS) {
				delete selected[field]
			}
			update(items, search)
			onChange("")
		}
	}
}