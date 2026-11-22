/**
 * Utilities for creating and managing dialogs from HTML templates
 */

import { EVENT_CLICK, EVENT_CLOSE } from "audiobus/events/event-constants"

export interface DialogOption {
	id: string
	label: string
	description?: string
	onClick: () => void | Promise<void>
}

let dialogIdCounter = 0

/**
 * Announce a status or alert message using a persistent live region in the document.
 * Keeps the live region mounted and visible (visually hidden) so ATs reliably announce updates.
 */
export function announceLive(
	message: string,
	priority: "polite" | "assertive" = "polite",
	doc: Document = document
): void {
	if (priority === "polite" && doc.documentElement.dataset.announcements === "minimal") {
		return
	}
	const id = priority === "assertive" ? "app-live-alert" : "app-live-status"
	let region = doc.getElementById(id)
	if (!region) {
		region = doc.createElement("div")
		region.id = id
		region.className = "sr-only"
		region.setAttribute("role", priority === "assertive" ? "alert" : "status")
		region.setAttribute("aria-live", priority)
		region.setAttribute("aria-atomic", "true")
		doc.body.append(region)
	}
	region.textContent = ""
	queueMicrotask(() => {
		if (region?.isConnected) {
			region.textContent = message
		}
	})
}

/**
 * Capture the currently focused element and return a cleanup callback that restores
 * focus to it (if still connected) when a modal closes.
 */
export function captureFocusReturn(
	fallback?: HTMLElement | null,
	doc: Document = document
): () => void {
	const previous =
		doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body
			? doc.activeElement
			: (fallback ?? null)
	return () => {
		const target = previous?.isConnected ? previous : fallback?.isConnected ? fallback : null
		target?.focus()
	}
}

/**
 * Open a modal `<dialog>` and restore focus to the previously focused element on close.
 */
export function openModalDialog(
	dialog: HTMLDialogElement,
	options: { removeOnClose?: boolean; returnFocusTo?: HTMLElement | null } = {}
): Promise<void> {
	const restoreFocus = captureFocusReturn(options.returnFocusTo, dialog.ownerDocument)
	dialog.hidden = false
	if (!dialog.open) {
		dialog.showModal()
	}
	return new Promise((resolve) => {
		const handleClose = () => {
			dialog.removeEventListener(EVENT_CLOSE, handleClose)
			if (options.removeOnClose) {
				dialog.remove()
			}
			restoreFocus()
			resolve()
		}
		dialog.addEventListener(EVENT_CLOSE, handleClose)
	})
}

/**
 * Creates a dialog from a template and populates it with options
 * @param templateId - ID of the template element to clone
 * @param options - Array of dialog options (buttons)
 * @returns The dialog element
 */
export function createDialogFromTemplate(
	templateId: string,
	options: DialogOption[]
): HTMLDialogElement {
	const template = document.getElementById(templateId) as HTMLTemplateElement
	if (!template) {
		throw new Error(`Template with ID "${templateId}" not found`)
	}

	// Clone the template content
	const clone = template.content.cloneNode(true) as DocumentFragment

	// Find or create the dialog element
	let dialog = clone.querySelector("dialog") as HTMLDialogElement | null
	if (!dialog) {
		dialog = document.createElement("dialog")
		dialog.appendChild(clone)
	}

	// Ensure cloned dialogs have a unique accessible title binding
	const heading = dialog.querySelector("h1, h2, h3, h4, h5, h6")
	if (heading && !dialog.getAttribute("aria-labelledby") && !dialog.getAttribute("aria-label")) {
		heading.id = heading.id || `template-dialog-title-${++dialogIdCounter}`
		dialog.setAttribute("aria-labelledby", heading.id)
	}

	// Get the menu element where buttons will be added
	const menu = dialog.querySelector("menu")
	if (!menu) {
		throw new Error(`Menu element not found in template "${templateId}"`)
	}

	// Clear existing menu items (but keep form)
	Array.from(menu.children).forEach((child) => {
		child.remove()
	})

	// Add option buttons
	options.forEach((option) => {
		const button = document.createElement("button")
		button.type = "button"
		button.className = "btn-option"
		button.id = option.id
		button.textContent = option.label

		if (option.description) {
			button.title = option.description
			button.setAttribute("aria-description", option.description)
		}

		button.addEventListener(EVENT_CLICK, async () => {
			try {
				await option.onClick()
				dialog!.close()
			} catch (error) {
				console.error(`Error in dialog option "${option.label}":`, error)
			}
		})

		menu.appendChild(button)
	})

	// Add the dialog to the DOM
	document.body.appendChild(dialog)

	return dialog
}

/**
 * Shows a dialog and returns a promise that resolves when it's closed
 * @param dialog - The dialog element to show
 * @returns Promise that resolves when dialog closes
 */
export function showDialog(dialog: HTMLDialogElement): Promise<void> {
	return openModalDialog(dialog, { removeOnClose: true })
}

/**
 * Convenience function to create and show a dialog
 * @param templateId - ID of the template element to clone
 * @param options - Array of dialog options
 * @returns Promise that resolves when dialog closes
 */
export async function showDialogFromTemplate(
	templateId: string,
	options: DialogOption[]
): Promise<void> {
	const dialog = createDialogFromTemplate(templateId, options)
	return showDialog(dialog)
}