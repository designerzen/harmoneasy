import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from 'react'
import { getAvailableOutputFactories, createOutputById } from 'audiobus/io/output-factory.ts'
import { getAvailableInstrumentFactories, createInstrumentById } from 'audiobus/instruments'
import type IOChain from 'audiobus/io/IO-chain.ts'

interface EndNodeProps {
	data?: any
	id?: string
}

const getIconForFactory = (factory: any, type: 'output' | 'instrument'): string => {
	// Map factory IDs to emojis or icon representations
	const iconMap: Record<string, string> = {
		// Outputs
		'notation': '🎼',
		'spectrum-analyser': '📊',
		'onscreen-keyboard': '⌨️',
		'pink-trombone': '🗣️',
		'speech-synthesis': '🔊',
		'vibrator': '📳',
		'webmidi': '🎹',
		'ble-midi': '📱',
		'console': '💻',
		// Instruments
		'polyphonic-synth': '🎹',
		'synth': '🎹',
	}

	return iconMap[factory.id] || (type === 'instrument' ? '🎸' : '🔌')
}

export function EndNode(props: EndNodeProps) {
	const chain = (window as any).chain as IOChain
	const isVertical = props.data?.layoutMode === 'vertical'

	const addOutputOrInstrument = useCallback(async () => {
		const outputFactories = getAvailableOutputFactories()
		const availableOutputs = outputFactories.filter((factory) => factory.isAvailable?.() !== false)

		const instrumentFactories = getAvailableInstrumentFactories()
		const availableInstruments = instrumentFactories

		if (availableOutputs.length === 0 && availableInstruments.length === 0) {
			console.warn("No available outputs or instruments to add")
			return
		}

		// Combine all items
		const allItems: FactoryWithType[] = [
			...availableOutputs.map((factory) => ({ factory, type: 'output' as const })),
			...availableInstruments.map((factory) => ({ factory, type: 'instrument' as const })),
		]

		// Create the merged dialog
		const dialog = document.createElement("dialog")
		dialog.setAttribute("closeby", "any")
		dialog.className = "add-output-dialog"

		// Header with title and single filter
		const header = document.createElement("header")
		const title = document.createElement("h5")
		title.textContent = "Add Output or Instrument"
		header.appendChild(title)

		const filterLabel = document.createElement("label")
		filterLabel.className = "dialog-filter"
		const filterIcon = document.createElement("span")
		filterIcon.className = "filter-icon"
		filterIcon.textContent = "🔍"
		const filterInput = document.createElement("input")
		filterInput.type = "text"
		filterInput.placeholder = "Search outputs and instruments..."
		filterInput.className = "filter-input-global"
		filterInput.autofocus = true
		filterLabel.appendChild(filterIcon)
		filterLabel.appendChild(filterInput)
		header.appendChild(filterLabel)

		dialog.appendChild(header)

		// Content area with grid layout
		const contentArea = document.createElement("div")
		contentArea.className = "dialog-content"

		// Outputs Section
		if (availableOutputs.length > 0) {
			const outputSection = document.createElement("section")
			outputSection.className = "dialog-section"

			const outputHeader = document.createElement("h6")
			outputHeader.className = "section-title"
			outputHeader.textContent = "Outputs"
			outputSection.appendChild(outputHeader)

			const outputGrid = document.createElement("div")
			outputGrid.className = "items-grid outputs-grid"

			const outputItems = availableOutputs.map((factory) => {
				const icon = getIconForFactory(factory, 'output')

				const item = document.createElement("button")
				item.type = "button"
				item.className = "grid-item output-item"
				item.id = `output-${factory.id}`
				item.dataset.type = "output"
				item.dataset.name = factory.name
				item.dataset.description = factory.description || ""

				const iconSpan = document.createElement("span")
				iconSpan.className = "item-icon"
				iconSpan.textContent = icon

				const nameSpan = document.createElement("span")
				nameSpan.className = "item-name"
				nameSpan.textContent = factory.name

				item.appendChild(iconSpan)
				item.appendChild(nameSpan)

				if (factory.description) {
					item.title = factory.description
				}

				item.addEventListener("click", async () => {
					try {
						const output = await createOutputById(factory.id)
						chain.addOutput(output)
						dialog.close()
					} catch (error) {
						console.error(`Failed to create output "${factory.name}":`, error)
					}
				})

				return { item, factory }
			})

			outputItems.forEach(({ item }) => {
				outputGrid.appendChild(item)
			})

			outputSection.appendChild(outputGrid)
			contentArea.appendChild(outputSection)
		}

		// Instruments Section
		if (availableInstruments.length > 0) {
			const instrumentSection = document.createElement("section")
			instrumentSection.className = "dialog-section"

			const instrumentHeader = document.createElement("h6")
			instrumentHeader.className = "section-title"
			instrumentHeader.textContent = "Instruments"
			instrumentSection.appendChild(instrumentHeader)

			const instrumentGrid = document.createElement("div")
			instrumentGrid.className = "items-grid instruments-grid"

			const instrumentItems = availableInstruments.map((factory) => {
				const icon = getIconForFactory(factory, 'instrument')

				const item = document.createElement("button")
				item.type = "button"
				item.className = "grid-item instrument-item"
				item.id = `instrument-${factory.id}`
				item.dataset.type = "instrument"
				item.dataset.name = factory.name
				item.dataset.description = factory.description || ""

				const iconSpan = document.createElement("span")
				iconSpan.className = "item-icon"
				iconSpan.textContent = icon

				const nameSpan = document.createElement("span")
				nameSpan.className = "item-name"
				nameSpan.textContent = factory.name

				item.appendChild(iconSpan)
				item.appendChild(nameSpan)

				if (factory.description) {
					item.title = factory.description
				}

				item.addEventListener("click", async () => {
					try {
						const instrument = await createInstrumentById(factory.id)
						chain.addOutput(instrument)
						dialog.close()
					} catch (error) {
						console.error(`Failed to create instrument "${factory.name}":`, error)
					}
				})

				return { item, factory }
			})

			instrumentItems.forEach(({ item }) => {
				instrumentGrid.appendChild(item)
			})

			instrumentSection.appendChild(instrumentGrid)
			contentArea.appendChild(instrumentSection)
		}

		dialog.appendChild(contentArea)

		// Global filter functionality
		const allItems_elements = contentArea.querySelectorAll(".grid-item")
		filterInput.addEventListener("input", (e) => {
			const searchTerm = (e.target as HTMLInputElement).value.toLowerCase()

			allItems_elements.forEach((element: Element) => {
				const item = element as HTMLElement
				const name = item.dataset.name?.toLowerCase() || ""
				const description = item.dataset.description?.toLowerCase() || ""

				const matches = name.includes(searchTerm) || description.includes(searchTerm)
				item.style.display = matches ? "" : "none"
			})
		})

		// Close button
		const form = document.createElement("form")
		form.method = "dialog"
		const closeButton = document.createElement("button")
		closeButton.type = "submit"
		closeButton.className = "btn-close"
		closeButton.textContent = "Close"
		form.appendChild(closeButton)
		dialog.appendChild(form)

		// Add to DOM and show
		document.body.appendChild(dialog)
		dialog.showModal()

		dialog.addEventListener("close", () => {
			dialog.remove()
		})

		// Focus filter input for immediate use
		setTimeout(() => filterInput.focus(), 0)
	}, [])

	return (
		<div className="node-end graph-node">
			<h6>Outputs</h6>
			<div className="button-group">
				<label>
					<span className="sr-only">Add Output or Instrument</span>
					<button className="cta btn-add" type="button" onClick={addOutputOrInstrument}>
						+ Add
					</button>
				</label>
			</div>
			<Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
			<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
		</div>
	)
}


