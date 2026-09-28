import { fillDeviceCard } from '../device-card'
import { SharedDevices } from '../SharedDevices'
import { useChain } from '../ChainContext'
import { Handle, Position } from "@xyflow/react"
import React, { useCallback } from 'react'

interface EndNodeProps {
	data?: any
	id?: string
}

export function EndNode(props: EndNodeProps) {
	const { chain, manager: ioManager } = useChain()
	const isVertical = props.data?.layoutMode === 'vertical'

	const addOutputOrInstrument = useCallback(async () => {
		const { createOutputById } = await import('audiobus/io/output-factory.ts')
		const { getAvailableInstrumentFactories, createInstrumentById } = await import('audiobus/instruments')
		
		const availableOutputs = await chain.outputManager.getAvailableFactories()

		const instrumentFactories = getAvailableInstrumentFactories()
		const availableInstruments = instrumentFactories

		if (availableOutputs.length === 0 && availableInstruments.length === 0) {
			console.warn("No available outputs or instruments to add")
			return
		}

		// Create the merged dialog
		const dialog = document.createElement("dialog")
		dialog.setAttribute("closeby", "any")
		dialog.className = "add-output-dialog"

		// Header with title and single filter
		const header = document.createElement("header")
		const title = document.createElement("h5")
		title.textContent = "Add New Output"
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

				const item = document.createElement("button")
				item.type = "button"
				item.className = "grid-item output-item"
				item.id = `output-${factory.id}`
				item.dataset.type = "output"
				item.dataset.name = factory.name
				item.dataset.description = factory.description || ""
                fillDeviceCard(item, factory, 'output')

				if (factory.description) {
					item.title = factory.description
				}

				item.addEventListener("click", async () => {
					try {
						let options: Record<string, any> | undefined
						if (ioManager?.outputMixer) {
							options = {
								mixer: ioManager.outputMixer,
								audioContext: ioManager.audioContext || (ioManager.outputMixer as any).context,
							}
						}
						const output = await createOutputById(factory.id, options)
						ioManager.addDevice(chain, output, 'output')
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

				const item = document.createElement("button")
				item.type = "button"
				item.className = "grid-item instrument-item"
				item.id = `instrument-${factory.id}`
				item.dataset.type = "instrument"
				item.dataset.name = factory.name
				item.dataset.description = factory.description || ""
                fillDeviceCard(item, factory, 'instrument')

				if (factory.description) {
					item.title = factory.description
				}

				item.addEventListener("click", async () => {
					try {
						let audioContext: AudioContext | undefined
						let options: Record<string, any> | undefined
						if (ioManager?.outputMixer) {
							audioContext = ioManager.audioContext || (ioManager.outputMixer as any).context
							options = {
								mixer: ioManager.outputMixer,
							}
						}
						const instrument = await createInstrumentById(audioContext!, factory.id, options)
						ioManager.addDevice(chain, instrument, 'output')
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

				const matches = (item.dataset.search ?? `${name} ${description}`).includes(searchTerm)
				item.style.display = matches ? "" : "none"
			})
		})

		// Close button
		const form = document.createElement("form")
		form.method = "dialog"
		const closeButton = document.createElement("button")
		closeButton.type = "submit"
		closeButton.className = "btn-close"
		closeButton.textContent = "×"
		closeButton.setAttribute("aria-label", "Cancel adding output")
		closeButton.title = "Cancel"
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
	}, [chain, ioManager])

	return (
		<div className="node-end graph-node">
			<h6>Outputs</h6>
            <SharedDevices direction="output" />
            <button className="cta btn-add nodrag nopan" type="button" onClick={addOutputOrInstrument}>
                Add New Output
            </button>
			<Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
			<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
		</div>
	)
}


