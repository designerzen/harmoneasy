/**
 * The shared loading motif: equaliser bars styled by assets/style/loader.scss.
 */

const BAR_COUNT = 4

export function createLoader(large = false): HTMLSpanElement {
	const loader = document.createElement("span")
	loader.className = large ? "loader loader-large" : "loader"
	loader.setAttribute("aria-hidden", "true")
	for (let index = 0; index < BAR_COUNT; index++) {
		loader.append(document.createElement("i"))
	}
	return loader
}

/**
 * Show a loader before the label of a button, or remove it.
 * Call after setting the button text, which replaces the loader.
 */
export function setButtonBusy(button: HTMLButtonElement, busy: boolean) {
	if (busy) {
		button.setAttribute("aria-busy", "true")
		if (!button.querySelector(":scope > .loader")) {
			button.prepend(createLoader())
		}
	} else {
		button.removeAttribute("aria-busy")
		button.querySelector(":scope > .loader")?.remove()
	}
}

/** Resolve once the browser has painted the current DOM. */
export const nextPaint = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	)

/**
 * Cover the page with a loader in the top layer, above modal dialogs.
 * Await the returned promise before starting blocking work so the veil paints first.
 */
export async function showLoadingVeil(message: string) {
	const veil = document.createElement("div")
	veil.className = "loading-veil"
	veil.popover = "manual"
	veil.setAttribute("role", "status")
	veil.setAttribute("aria-live", "polite")
	const text = document.createElement("p")
	text.textContent = message
	veil.append(createLoader(true), text)
	document.body.append(veil)
	veil.showPopover()
	await nextPaint()
	return {
		update(next: string) {
			text.textContent = next
		},
		hide() {
			veil.hidePopover()
			veil.remove()
		}
	}
}