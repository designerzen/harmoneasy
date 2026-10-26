import { choiceFilterOptions, type ClassifiedChoice } from './device-filters'
import { element, option } from './dom'

export function createClassificationFilter({
	choices,
	value,
	onChange,
	label,
	compact = false,
}: {
	choices: ClassifiedChoice[]
	value: string
	onChange: (value: string) => void
	label: string
	compact?: boolean
}) {
	const host = element('label', `classification-filter${compact ? ' classification-filter-compact' : ''}`)
	const select = element('select')
	select.setAttribute('aria-label', label)
	if (!compact) host.append(element('span', '', label))
	else
		host.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>'
	const update = (items: ClassifiedChoice[]) => {
		const groups = choiceFilterOptions(items)
		const previous = select.value
		select.replaceChildren(option('All types and subtypes', ''))
		for (const group of groups) {
			const node = element('optgroup')
			node.label = group.label
			node.append(...group.options.map((item) => option(item.label, item.value)))
			select.append(node)
		}
		select.value = previous
		host.title = `${label}: ${select.selectedOptions[0]?.textContent ?? 'All types and subtypes'}`
		host.dataset.active = String(Boolean(select.value))
	}
	update(choices)
	select.value = value
	select.onchange = () => {
		host.dataset.active = String(Boolean(select.value))
		host.title = `${label}: ${select.selectedOptions[0]?.textContent}`
		onChange(select.value)
	}
	host.append(select)
	return { element: host, update }
}