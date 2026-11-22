import { TRANSFORMER_DEFINITIONS } from "audiobus/io/transformer-definitions"
import { createClassificationFilter } from "./ClassificationFilter"
import { choiceMatches, groupChoices } from "./device-filters"
import { elementDescription, elementIcon } from "./element-icons"
import type { Transformer } from "audiobus/io/transformers/abstract-transformer"
import { tranformerFactory, TRANSFORMERS } from "audiobus/io/transformer-factory"
import type { ChainUIContext } from "./chain-ui-context"
import { element, button, icon, searchReset } from "./dom"
import { deviceAvailability } from "audiobus/io/device-requirements"
import { createUnavailableSection, markUnavailable } from "./unavailable-choices"

export function createTransformerPicker(
	{ chain }: ChainUIContext,
	{
		dialog = false,
		replacing,
		onAdded
	}: {
		dialog?: boolean
		replacing?: Transformer<any>
		onAdded?: () => void
	} = {}
) {
	const host = element("div", "transformer-picker")
	const error = element("p")
	error.setAttribute("role", "alert")
	error.hidden = true
	const row = element("div", "picker-filter-row")
	const searchLabel = element("div", dialog ? "dialog-filter" : "filter-label filter-transformer")
	const search = element("input", dialog ? "filter-input-global" : "")
	search.type = "search"
	search.placeholder = "Search transformers…"
	search.autofocus = dialog
	search.setAttribute("aria-label", "Search transformers")
	searchLabel.innerHTML =
		'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>'
	searchLabel.append(search)
	const choices = TRANSFORMERS.map((id) => TRANSFORMER_DEFINITIONS[id]).flatMap((definition) => {
		const { hidden, missing } = deviceAvailability(definition)
		return hidden ? [] : [{ ...definition, missing }]
	})
	let classification = ""
	const filter = createClassificationFilter({
		choices,
		value: "",
		label: "Filter transformers by type",
		onChange: (value) => {
			classification = value
			render()
		}
	})
	const updateReset = searchReset(searchLabel, search, () => {
		search.value = ""
		filter.clear()
	})
	row.append(searchLabel, filter.element)
	const results = element("div")
	host.append(error, row, results)
	const onAdd = (transformerType: string) => () => {
		try {
			if (chain.isDestroyed) {
				throw new Error("This chain has been deleted")
			}
			const transformers = chain.transformerManager.activeTransformers
			if (replacing && !transformers.includes(replacing)) {
				throw new Error("This transformer has been removed")
			}
			const next = tranformerFactory(transformerType) as Transformer<any>
			if (replacing) {
				chain.clearNoteCommands()
				chain.setTransformers(
					transformers.map((transformer) =>
						transformer === replacing ? next : transformer
					)
				)
			} else {
				chain.appendTransformer(next)
			}
			onAdded?.()
		} catch (failure) {
			error.textContent = String(failure)
			error.hidden = false
		}
	}

	function choiceItem(choice: (typeof choices)[number]) {
		const item = element("li")
		const node = button(
			"",
			onAdd(choice.id),
			dialog ? "grid-item transformer-choice" : "element-choice"
		)
		node.title = elementDescription("transformer", choice.id, choice.name, choice.description)
		node.append(
			icon(elementIcon("transformer", choice.id), node.title),
			element("span", "", choice.name)
		)
		if (dialog) {
			node.append(element("small", "item-description", choice.description))
		}
		if (choice.missing.length) {
			markUnavailable(node, choice.missing)
		}
		item.append(node)
		return item
	}

	const statusCount = element("p", "")
	statusCount.setAttribute("role", "status")
	statusCount.setAttribute("aria-live", "polite")
	const resultsHost = element("div")
	results.append(statusCount, resultsHost)

	function render() {
		updateReset(Boolean(search.value || classification))
		filter.update(choices, search.value)
		resultsHost.replaceChildren()
		const matching = choices.filter((choice) =>
			choiceMatches(choice, search.value, classification)
		)
		const filtered = matching.filter((choice) => !choice.missing.length)
		const unavailable = matching.filter((choice) => choice.missing.length)
		statusCount.textContent =
			!filtered.length && !unavailable.length
				? "No transformers match the selected filters"
				: `${filtered.length} matching transformers`
		for (const group of groupChoices(filtered)) {
			const section = element("section", "choice-group")
			section.setAttribute("aria-label", group.label)
			section.append(element("h3", "section-title", group.label))
			const list = element("ul", dialog ? "items-grid" : "")
			list.setAttribute("role", "list")
			list.append(...group.items.map(choiceItem))
			section.append(list)
			resultsHost.append(section)
		}
		if (unavailable.length) {
			resultsHost.append(
				createUnavailableSection(unavailable.map(choiceItem), dialog, "transformers")
			)
		}
		if (!filtered.length && !unavailable.length) {
			resultsHost.append(element("p", "", "No transformers match the selected filters"))
		}
	}
	search.oninput = render
	render()
	return {
		element: host,
		destroy() {
			host.remove()
		}
	}
}