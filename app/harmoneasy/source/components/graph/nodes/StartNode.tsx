import { fillDeviceCard } from '../device-card'
import { SharedDevices } from '../SharedDevices'
import { useChain } from '../ChainContext'
import { Handle, Position } from "@xyflow/react";
import React, { useCallback } from "react";

interface StartNodeProps {
	data?: any;
	id?: string;
}

export function StartNode(props: StartNodeProps) {
	const { chain, manager: ioManager } = useChain()
	const isVertical = props.data?.layoutMode === "vertical";

	const addInput = useCallback(async () => {
		const { createInputById } = await import("audiobus/io/input-factory.ts");
		const availableFactories = await chain.inputManager.getAvailableFactories();

		if (availableFactories.length === 0) {
			console.warn("No available inputs to add");
			return;
		}

		// Create the dialog
		const dialog = document.createElement("dialog");
		dialog.setAttribute("closedby", "any");
		dialog.setAttribute("aria-label", "Add New Input");
		dialog.className = "add-input-dialog";

		// Header with title and single filter
		const header = document.createElement("header");
		const title = document.createElement("h5");
		title.textContent = "Add New Input";
		header.appendChild(title);

		const filterLabel = document.createElement("label");
		filterLabel.className = "dialog-filter";
		const filterIcon = document.createElement("span");
		filterIcon.className = "filter-icon";
		filterIcon.textContent = "🔍";
		const filterInput = document.createElement("input");
		filterInput.type = "text";
		filterInput.placeholder = "Search inputs...";
		filterInput.setAttribute("aria-label", "Search inputs");
		filterInput.className = "filter-input-global";
		filterInput.autofocus = true;
		filterLabel.appendChild(filterIcon);
		filterLabel.appendChild(filterInput);
		header.appendChild(filterLabel);

		dialog.appendChild(header);

		// Content area with grid layout
		const contentArea = document.createElement("div");
		contentArea.className = "dialog-content";

		// Inputs Section
		const inputSection = document.createElement("section");
		inputSection.className = "dialog-section";

		const inputHeader = document.createElement("h6");
		inputHeader.className = "section-title";
		inputHeader.textContent = "Input Devices";
		inputSection.appendChild(inputHeader);

		const inputGrid = document.createElement("div");
		inputGrid.className = "items-grid inputs-grid";

		const inputItems = availableFactories.map((factory) => {

			const item = document.createElement("button");
			item.type = "button";
			item.className = "grid-item input-item";
			item.id = `input-${factory.id}`;
			item.dataset.type = "input";
			item.dataset.name = factory.name;
			item.dataset.description = factory.description || "";
                fillDeviceCard(item, factory, 'input')

			if (factory.description) {
				item.title = factory.description;
			}

			item.addEventListener("click", async () => {
				try {
					const input = await createInputById(factory.id, ioManager.deviceOptions);
					ioManager.addDevice(chain, input, 'input');
					dialog.close();
				} catch (error) {
					console.error(`Failed to create input "${factory.name}":`, error);
				}
			});

			return { item, factory };
		});

		inputItems.forEach(({ item }) => {
			inputGrid.appendChild(item);
		});

		inputSection.appendChild(inputGrid);
		contentArea.appendChild(inputSection);

		dialog.appendChild(contentArea);

		// Global filter functionality
		const allItems_elements = contentArea.querySelectorAll(".grid-item");
		filterInput.addEventListener("input", (e) => {
			const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();

			allItems_elements.forEach((element: Element) => {
				const item = element as HTMLElement;
				const name = item.dataset.name?.toLowerCase() || "";
				const description = item.dataset.description?.toLowerCase() || "";

				const matches = (item.dataset.search ?? `${name} ${description}`).includes(searchTerm);
				item.style.display = matches ? "" : "none";
			});
		});

		// Close button
		const form = document.createElement("form");
		form.method = "dialog";
		const closeButton = document.createElement("button");
		closeButton.type = "submit";
		closeButton.className = "btn-close";
		closeButton.textContent = "×";
		closeButton.setAttribute("aria-label", "Cancel adding input");
		closeButton.title = "Cancel";
		form.appendChild(closeButton);
		dialog.appendChild(form);

		// Add to DOM and show
		document.body.appendChild(dialog);
		dialog.showModal();

		dialog.addEventListener("close", () => {
			dialog.remove();
		});

		// Focus filter input for immediate use
		setTimeout(() => filterInput.focus(), 0);
	}, [chain, ioManager]);

	return (
		<div className="node-start graph-node">
			<h6>Inputs</h6>
            <SharedDevices direction="input" />
            <button className="cta btn-add nodrag nopan" type="button" onClick={addInput}>
                Add New Input
            </button>
			<Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
			<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
		</div>
	);
}
