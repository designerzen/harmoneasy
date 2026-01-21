/**
 * Utilities for creating and managing dialogs from HTML templates
 */

export interface DialogOption {
	id: string
	label: string
	description?: string
	onClick: () => void | Promise<void>
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
		}

		button.addEventListener("click", async () => {
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
	dialog.showModal()

	return new Promise((resolve) => {
		const handleClose = () => {
			dialog.removeEventListener("close", handleClose)
			dialog.remove()
			resolve()
		}

		dialog.addEventListener("close", handleClose)
	})
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
