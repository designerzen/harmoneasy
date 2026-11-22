import { describeMissing } from "audiobus/io/device-requirements"
import { element } from "./dom"

/** Disable a picker choice this browser cannot run and say what it needs */
export function markUnavailable(node: HTMLButtonElement, missing: string[]) {
	const reason = describeMissing(missing)
	node.disabled = true
	node.classList.add("unavailable-choice")
	node.title = node.title ? `${node.title} (${reason})` : reason
	node.append(element("small", "item-requirement", reason))
}

/** Unusable choices go last, under their own heading, so usable ones are seen first */
export function createUnavailableSection(items: HTMLElement[], dialog: boolean, noun: string) {
	const section = element("section", "choice-group unavailable-choices")
	section.setAttribute("aria-label", `Unavailable ${noun}`)
	section.append(
		element("h3", "section-title", "Not available in this browser"),
		element(
			"p",
			"unavailable-note",
			`These ${noun} need features this browser or device does not have.`
		)
	)
	const list = element("ul", dialog ? "items-grid" : "")
	list.setAttribute("role", "list")
	list.append(...items)
	section.append(list)
	return section
}