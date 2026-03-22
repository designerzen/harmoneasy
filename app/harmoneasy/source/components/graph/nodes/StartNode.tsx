import { Handle, Position } from "@xyflow/react";
import React, { useCallback } from "react";
import type IOChain from "audiobus/io/IO-chain.ts";

interface StartNodeProps {
	data?: any;
	id?: string;
}

const getIconForFactory = (factory: any): string => {
	// Map factory IDs to emojis or icon representations
	const iconMap: Record<string, string> = {
		midi: "🎹",
		webmidi: "🎹",
		"ble-midi": "📱",
		keyboard: "⌨️",
		microphone: "🎤",
		gamepad: "🕹️",
		"midi-in": "🎹",
	};

	return iconMap[factory.id] || "🎵";
};

export function StartNode(props: StartNodeProps) {
	const chain = (window as any).chain as IOChain;
	const isVertical = props.data?.layoutMode === "vertical";

	const addInput = useCallback(async () => {
		const { getAvailableInputFactories, createInputById } = await import("audiobus/io/input-factory.ts");
		const factories = getAvailableInputFactories();
		const availableFactories = factories.filter((factory) => factory.isAvailable?.() !== false);

		if (availableFactories.length === 0) {
			console.warn("No available inputs to add");
			return;
		}

		// Create the dialog
		const dialog = document.createElement("dialog");
		dialog.setAttribute("closeby", "any");
		dialog.className = "add-input-dialog";

		// Header with title and single filter
		const header = document.createElement("header");
		const title = document.createElement("h5");
		title.textContent = "Add Input";
		header.appendChild(title);

		const filterLabel = document.createElement("label");
		filterLabel.className = "dialog-filter";
		const filterIcon = document.createElement("span");
		filterIcon.className = "filter-icon";
		filterIcon.textContent = "🔍";
		const filterInput = document.createElement("input");
		filterInput.type = "text";
		filterInput.placeholder = "Search inputs...";
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
			const icon = getIconForFactory(factory);

			const item = document.createElement("button");
			item.type = "button";
			item.className = "grid-item input-item";
			item.id = `input-${factory.id}`;
			item.dataset.type = "input";
			item.dataset.name = factory.name;
			item.dataset.description = factory.description || "";

			const iconSpan = document.createElement("span");
			iconSpan.className = "item-icon";
			iconSpan.textContent = icon;

			const nameSpan = document.createElement("span");
			nameSpan.className = "item-name";
			nameSpan.textContent = factory.name;

			item.appendChild(iconSpan);
			item.appendChild(nameSpan);

			if (factory.description) {
				item.title = factory.description;
			}

			item.addEventListener("click", async () => {
				try {
					const input = await createInputById(factory.id);
					chain.addInput(input as any);
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

				const matches = name.includes(searchTerm) || description.includes(searchTerm);
				item.style.display = matches ? "" : "none";
			});
		});

		// Close button
		const form = document.createElement("form");
		form.method = "dialog";
		const closeButton = document.createElement("button");
		closeButton.type = "submit";
		closeButton.className = "btn-close";
		closeButton.textContent = "Close";
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
	}, []);

	return (
		<div className="node-start graph-node">
			<h6>Inputs</h6>
			<label>
				<span className="sr-only">Add Input Device</span>
				<button className="cta btn-add" type="button" onClick={addInput}>
					Add
				</button>
			</label>
			<Handle type="source" position={isVertical ? Position.Bottom : Position.Right} />
			<Handle type="target" position={isVertical ? Position.Top : Position.Left} />
		</div>
	);
}