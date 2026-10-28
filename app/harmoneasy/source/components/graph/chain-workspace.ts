import type IOChain from 'audiobus/io/IO-chain'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { EVENT_CHAINS_UPDATED, EVENT_CHAIN_ACTIVE_CHANGED, EVENT_KEY_DOWN } from 'audiobus/event-constants'
import { DEFAULT_LAYOUT_MODE } from './options'
import { createIOChainManagerUI } from './IOChainManagerUI'
import { createPresets } from './Presets'
import { createChainName } from './ChainName'
import { createChainSidebar } from './ChainSidebar'
import { element, button, option } from './dom'
import type { ChainUIContext } from './chain-ui-context'

export interface GraphView {
	update(isFront: boolean, focusRequest: number): void
	destroy(): void
}
export function createChainWorkspace(
	container: HTMLElement,
	manager: IOChainManager,
	mountGraph: (host: HTMLElement, context: ChainUIContext) => GraphView,
) {
	const host = element('div', 'chains-workspace chains-stacked')
	container.append(host)
	const navigation = document.getElementById('chain-navigation')
	const settings = document.getElementById('graph-layout-settings')
	const tabs = element('div')
	tabs.setAttribute('role', 'tablist')
	tabs.setAttribute('aria-label', 'Chains')
	const newChain = createIOChainManagerUI(manager)
	if (navigation) navigation.append(tabs, newChain.element)
	else host.append(newChain.element)
	const warnings = element('div'),
		empty = element('p', '', 'No IOChains. Add a chain to start routing inputs to outputs.')
	warnings.style.display = 'contents'
	host.append(warnings, empty)
	let front: string | null = manager.activeChainId,
		solo: string | null = null,
		focusRequest = 0,
		scrollFrame: number | null = null,
		overflow: string | null = null
	const views = new Map<string, ReturnType<typeof createPanel>>()
	const focus = (id: string) => {
		front = id
		focusRequest++
		render()
		if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = null
			views.get(id)?.element.scrollIntoView?.({ block: 'start', inline: 'nearest' })
		})
	}
	const toggleSolo = (id: string) => {
		front = id
		solo = solo === id ? null : id
		render()
	}
	function createPanel(chainId: string, chain: IOChain) {
		const context = { chain, chainId, manager }
		const panel = element('section')
		panel.id = `iochain-${chainId}`
		panel.dataset.midiScope = chainId
		panel.tabIndex = -1
		panel.setAttribute('role', 'tabpanel')
		panel.setAttribute('aria-labelledby', `chain-tab-${chainId}`)
		const toolbar = element('header', 'chain-toolbar')
		const identity = element('div', 'chain-identity')
		const power = button('', () => chain.setActive(!chain.isActive), 'chain-power chain-icon-button')
		power.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10M6 5a9 9 0 1 0 12 0" /></svg>'
		const powerText = element('span')
		power.append(powerText)
		const name = createChainName(chain)
		identity.append(power, name.element)
		const presets = createPresets(chain, manager)
		const actions = element('div', 'chain-actions')
		const action = element('select')
		action.className = 'chain-action-picker'
		action.setAttribute('aria-label', 'Actions')
		const actionOption = (text: string, value: string, path: string) => {
			const item = option('', value)
			item.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`
			item.append(element('span', '', text))
			return item
		}
		const placeholder = option('Actions', '')
		placeholder.disabled = true
		const soloOption = actionOption('Solo', 'solo', 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6')
		const layoutGroup = element('optgroup')
		layoutGroup.label = 'Graph layout'
		const horizontal = actionOption('Horizontal layout', 'horizontal', 'M3 4h6v16H3zM15 4h6v16h-6zM9 12h6'),
			vertical = actionOption('Vertical layout', 'vertical', 'M4 3h16v6H4zM4 15h16v6H4zM12 9v6')
		layoutGroup.append(horizontal, vertical)
		action.append(
			placeholder,
			actionOption('Save as a Preset', 'save-preset', 'M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8'),
			actionOption('Clone chain', 'clone', 'M9 9h12v12H9zM15 9V3H3v12h6'),
			soloOption,
			layoutGroup,
			actionOption('Delete chain', 'delete', 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'),
		)
		action.value = ''
		action.onchange = () => {
			const value = action.value
			action.value = ''
			if (value === 'horizontal' || value === 'vertical')
				chain.setGraphOptions({ graphLayout: value, positions: {} })
			else if (value === 'clone') void manager.cloneChain(chainId)
			else if (value === 'delete') manager.removeChain(chainId)
			else if (value === 'solo') toggleSolo(chainId)
			else if (value === 'save-preset') presets.openSave()
		}
		actions.append(action)
		const expand = button('', () => toggleSolo(chainId), 'chain-solo-toggle chain-icon-button')
		expand.innerHTML =
			'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path /></svg>'
		toolbar.append(identity, presets.element, actions, expand)
		const graph = element('div', 'chain-graph')
		const sidebar = createChainSidebar(context)
		const canvas = element('div', 'chain-graph-canvas')
		graph.append(sidebar.element, canvas)
		panel.append(toolbar, graph)
		host.append(panel)
		const graphView = mountGraph(canvas, context)
		const layoutLabel = element('label')
		layoutLabel.dataset.midiScope = `${chainId}:layout`
		const layoutName = document.createTextNode('')
		const layoutSelect = element('select')
		layoutSelect.append(option('Vertical', 'vertical'), option('Horizontal', 'horizontal'))
		layoutSelect.onchange = () =>
			chain.setGraphOptions({ graphLayout: layoutSelect.value as 'horizontal' | 'vertical', positions: {} })
		layoutLabel.append(layoutName, layoutSelect)
		return {
			element: panel,
			chain,
			layoutLabel,
			update(index: number) {
				const isFront = front === chainId,
					isSolo = solo === chainId
				panel.className = `chain-panel ${chain.isActive ? 'active' : 'inactive'} ${isFront ? 'chain-front' : ''} ${isSolo ? 'chain-solo' : ''}`
				panel.hidden = (solo ?? front) !== chainId
				panel.inert = panel.hidden
				panel.setAttribute('aria-label', chain.options.name ?? `Chain ${index + 1}`)
				power.title = chain.isActive
					? 'Turn chain off'
					: 'Turn chain on — settings are still editable while off'
				power.setAttribute('aria-label', chain.isActive ? 'Turn chain off' : 'Turn chain on')
				power.setAttribute('aria-pressed', String(chain.isActive))
				powerText.textContent = chain.isActive ? 'On' : 'Off'
				name.update()
				soloOption.querySelector('span')!.textContent = isSolo ? 'Exit Solo' : 'Solo'
				const mode = chain.options.graphLayout ?? DEFAULT_LAYOUT_MODE
				horizontal.disabled = mode === 'horizontal'
				vertical.disabled = mode === 'vertical'
				expand.title = isSolo ? 'Exit fullscreen chain' : 'Expand chain'
				expand.setAttribute('aria-label', expand.title)
				expand.setAttribute('aria-expanded', String(isSolo))
				expand
					.querySelector('path')!
					.setAttribute(
						'd',
						isSolo ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6',
					)
				layoutName.textContent = chain.options.name ?? `Chain ${index + 1}`
				layoutSelect.value = mode
				graphView.update(isFront, isFront ? focusRequest : 0)
			},
			destroy() {
				graphView.destroy()
				sidebar.destroy()
				presets.destroy()
				layoutLabel.remove()
				panel.remove()
			},
		}
	}
	function render() {
		const entries = manager.entries
		if (!entries.some(([id]) => id === front)) front = entries[0]?.[0] ?? null
		if (!entries.some(([id]) => id === solo)) solo = null
		if (solo && overflow === null) {
			overflow = document.body.style.overflow
			document.body.style.overflow = 'hidden'
		}
		if (!solo && overflow !== null) {
			document.body.style.overflow = overflow
			overflow = null
		}
		for (const [id, view] of views) {
			if (!entries.some(([chainId, chain]) => chainId === id && chain === view.chain)) {
				view.destroy()
				views.delete(id)
			}
		}
		tabs.replaceChildren()
		for (const [index, [id, chain]] of entries.entries()) {
			let view = views.get(id)
			if (!view) {
				view = createPanel(id, chain)
				views.set(id, view)
			}
			view.update(index)
			const tab = element('span', 'chain-tab')
			tab.setAttribute('role', 'presentation')
			const select = button(chain.options.name ?? `Chain ${index + 1}`, () => focus(id))
			select.id = `chain-tab-${id}`
			select.setAttribute('role', 'tab')
			select.setAttribute('aria-controls', view.element.id)
			select.setAttribute('aria-selected', String(front === id))
			select.tabIndex = front === id ? 0 : -1
			select.onkeydown = (event) => {
				const next =
					event.key === 'ArrowRight'
						? (index + 1) % entries.length
						: event.key === 'ArrowLeft'
							? (index + entries.length - 1) % entries.length
							: event.key === 'Home'
								? 0
								: event.key === 'End'
									? entries.length - 1
									: null
				if (next === null) return
				event.preventDefault()
				focus(entries[next][0])
				document.getElementById(`chain-tab-${entries[next][0]}`)?.focus({ preventScroll: true })
			}
			const remove = button(
				'×',
				() => {
					if (
						!window.confirm(
							`Are you sure you want to remove “${chain.options.name ?? `Chain ${index + 1}`}”?`,
						)
					)
						return
					const nextId = entries[index + 1]?.[0] ?? entries[index - 1]?.[0] ?? null
					if (front === id) front = nextId
					manager.removeChain(id)
					if (nextId) document.getElementById(`chain-tab-${nextId}`)?.focus()
				},
				'chain-tab-remove',
			)
			remove.title = 'Remove chain'
			remove.setAttribute('aria-label', `Remove ${chain.options.name ?? `Chain ${index + 1}`}`)
			tab.append(select, remove)
			tabs.append(tab)
		}
		if (settings) settings.replaceChildren(...entries.map(([id]) => views.get(id)!.layoutLabel))
		if (settings && !entries.length) settings.append(element('p', '', 'Add a chain to choose its layout.'))
		warnings.replaceChildren(
			...manager.restoreWarnings.map((warning) => {
				const node = element('p', '', warning)
				node.setAttribute('role', 'status')
				return node
			}),
		)
		empty.hidden = !!entries.length
	}
	const activeChanged = () => {
		if (manager.activeChainId) front = manager.activeChainId
		focusRequest++
		render()
	}
	const keydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && solo && !document.querySelector('dialog[open]')) {
			solo = null
			render()
		}
	}
	manager.addEventListener(EVENT_CHAINS_UPDATED, render)
	manager.addEventListener(EVENT_CHAIN_ACTIVE_CHANGED, activeChanged)
	document.addEventListener(EVENT_KEY_DOWN, keydown)
	const transport = document.getElementById('midi-transport-control'),
		actionBar = document.getElementById('action-bar')
	const updateOffset = () => {
		if (!transport) return
		document.documentElement.style.setProperty(
			'--transport-height',
			`${transport.getBoundingClientRect().height}px`,
		)
		document.documentElement.style.setProperty(
			'--action-bar-height',
			`${actionBar?.getBoundingClientRect().height ?? 0}px`,
		)
	}
	const observer = transport && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateOffset) : null
	if (transport) observer?.observe(transport)
	if (actionBar) observer?.observe(actionBar)
	updateOffset()
	render()
	let destroyed = false
	return {
		destroy() {
			if (destroyed) return
			destroyed = true
			if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
			manager.removeEventListener(EVENT_CHAINS_UPDATED, render)
			manager.removeEventListener(EVENT_CHAIN_ACTIVE_CHANGED, activeChanged)
			document.removeEventListener(EVENT_KEY_DOWN, keydown)
			observer?.disconnect()
			document.documentElement.style.removeProperty('--transport-height')
			document.documentElement.style.removeProperty('--action-bar-height')
			if (overflow !== null) document.body.style.overflow = overflow
			for (const view of views.values()) view.destroy()
			newChain.destroy()
			tabs.remove()
			settings?.replaceChildren()
			host.remove()
		},
	}
}
