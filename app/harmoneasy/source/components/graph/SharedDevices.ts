import type { ChainUIContext } from './chain-ui-context'
import { deviceIcon, elementDescription } from './element-icons'
import { deviceDefinition } from 'audiobus/io/device-definition'
import { INPUT_DEFINITIONS } from 'audiobus/io/input-definitions'
import { OUTPUT_DEFINITIONS } from 'audiobus/io/output-definitions'
import { INSTRUMENTS } from 'audiobus/instruments/instrument-types'
import { choiceMatches } from './device-filters'
import { element, button, icon } from './dom'

export function createSharedDevices(
	{ chainId, manager }: ChainUIContext,
	{
		direction,
		search = '',
		selection = '',
		disabled = false,
		onSelect,
	}: {
		direction: 'input' | 'output'
		search?: string
		selection?: string
		disabled?: boolean
		onSelect?: (device: any) => void
	},
) {
	const available = manager.devices.filter((entry) => {
		if (entry.direction !== direction || entry.chains.has(chainId)) return false
		try {
			const definition = deviceDefinition(entry.device)
			const metadata =
				definition.factory === 'instrument'
					? INSTRUMENTS.get(definition.type!)
					: (direction === 'input' ? INPUT_DEFINITIONS : OUTPUT_DEFINITIONS)[definition.type!]
			if (metadata)
				return choiceMatches(
					{ ...metadata, name: entry.device.name, description: entry.device.description },
					search,
					selection,
				)
		} catch {
			/* External devices may not have registered metadata. */
		}
		return (
			!selection &&
			`${entry.device.name} ${entry.device.description}`.toLowerCase().includes(search.trim().toLowerCase())
		)
	})
	const section = element('section', 'shared-device-selector nodrag nopan nowheel')
	section.hidden = !available.length
	section.setAttribute('aria-label', `Use existing ${direction}`)
	section.append(element('h6', '', `Use existing ${direction}`))
	const list = element('ul')
	for (const entry of available) {
		const item = element('li')
		const choice = button(
			'',
			() => (onSelect ? onSelect(entry.device) : manager.attachDevice(chainId, entry.id)),
			'element-choice',
		)
		choice.disabled = disabled
		choice.title = elementDescription(direction, entry.id, entry.device.name, entry.device.description)
		choice.append(icon(deviceIcon(entry.device, direction), choice.title), element('span', '', entry.device.name))
		item.append(choice)
		list.append(item)
	}
	section.append(list)
	return section
}