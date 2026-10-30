import {
	EVENT_BLUR,
	EVENT_CANCEL,
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_CLOSE,
	EVENT_FOCUS_OUT,
	EVENT_INPUT,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_SUBMIT
} from "audiobus/event-constants"
import {
	commandSearchField,
	commandSearchScore,
	normalizeCommandSearch
} from "../libs/command-search"

type ValueControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
type Command = {
	element: HTMLElement
	label: string
	context: string
	fields: ReturnType<typeof commandSearchField>[]
}
const CONTROL_SELECTOR = "button, summary, input, select, textarea"
const TEXT_TYPES = new Set([
	"text",
	"search",
	"url",
	"email",
	"tel",
	"number",
	"range",
	"color",
	"date",
	"time",
	"datetime-local",
	"month",
	"week"
])

function isValueControl(element: HTMLElement): element is ValueControl {
	return (
		element instanceof HTMLInputElement ||
		element instanceof HTMLSelectElement ||
		element instanceof HTMLTextAreaElement
	)
}

function labelText(element: Element | null): string {
	const copy = element?.cloneNode(true) as Element | undefined
	copy?.querySelectorAll('input, select, textarea, output, small, [aria-hidden="true"]').forEach(
		(child) => child.remove()
	)
	return copy?.textContent?.replace(/\s+/g, " ").trim() ?? ""
}

function controlLabel(element: HTMLElement): string {
	const labelledBy = element
		.getAttribute("aria-labelledby")
		?.split(/\s+/)
		.map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
		.join(" ")
		.trim()
	const label = isValueControl(element) ? (element.labels?.[0] ?? element.closest("label")) : null
	return (
		element.getAttribute("aria-label") ||
		labelledBy ||
		element.dataset.midiControl ||
		labelText(label) ||
		(element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)
			? element.value
			: "") ||
		element.title ||
		(isValueControl(element) ? element.getAttribute("placeholder") : labelText(element)) ||
		element.getAttribute("name") ||
		element.id
	)
}

function controlContext(element: HTMLElement): string {
	const names: string[] = []
	for (let group = element.parentElement; group; group = group.parentElement) {
		if (
			!group.matches(
				'[data-midi-label], fieldset, [data-midi-scope], [role="group"], details, dialog, [id^="iochain-"]'
			)
		) {
			continue
		}
		const labelledBy = group
			.getAttribute("aria-labelledby")
			?.split(/\s+/)
			.map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
			.join(" ")
			.trim()
		const name =
			group.getAttribute("data-midi-label") ||
			group.getAttribute("aria-label") ||
			labelledBy ||
			labelText(
				group.querySelector(
					":scope > legend, :scope > summary, :scope > header :is(h2, h5, h6), :scope > h2"
				)
			)
		if (name && !names.includes(name)) {
			names.unshift(name)
		}
	}
	return names.join(" / ")
}

function available(element: HTMLElement): boolean {
	if (
		!element.isConnected ||
		element.matches(':disabled, [aria-disabled="true"]') ||
		element.closest('[hidden], [aria-hidden="true"], [inert]')
	) {
		return false
	}
	if (
		(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
		element.readOnly
	) {
		return false
	}
	if (element instanceof HTMLSelectElement && element.multiple) {
		return false
	}
	if (
		element instanceof HTMLInputElement &&
		!TEXT_TYPES.has(element.type) &&
		!["checkbox", "radio", "button", "submit", "reset"].includes(element.type)
	) {
		return false
	}
	// Closed dialogs are reached through their opening commands first.
	if (element.closest("dialog:not([open])")) {
		return false
	}
	for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
		if (
			ancestor instanceof HTMLFieldSetElement &&
			ancestor.disabled &&
			!ancestor.querySelector(":scope > legend")?.contains(element)
		) {
			return false
		}
		const style = getComputedStyle(ancestor)
		if (style.display === "none" || style.visibility === "hidden") {
			return false
		}
	}
	return true
}

function currentValue(element: HTMLElement): string {
	if (element instanceof HTMLSelectElement) {
		return element.selectedOptions[0]?.textContent ?? ""
	}
	if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
		return element.checked ? "On" : "Off"
	}
	if (isValueControl(element)) {
		return element.value
	}
	const pressed = element.getAttribute("aria-pressed")
	return pressed === null ? "Run" : pressed === "true" ? "On" : "Off"
}

export function createCommandPalette(root: Document, signal?: AbortSignal) {
	const dialog = root.querySelector<HTMLDialogElement>("#command-palette")!
	const search = dialog.querySelector<HTMLInputElement>("#command-search")!
	const results = dialog.querySelector<HTMLElement>("#command-results")!
	const editorPanel = dialog.querySelector<HTMLElement>("#command-editor")!
	const editorLabel = dialog.querySelector<HTMLLabelElement>("#command-value-label")!
	const editorHost = dialog.querySelector<HTMLElement>("#command-value-host")!
	const status = dialog.querySelector<HTMLElement>("#command-status")!
	const options = { signal }
	let commands: Command[] = []
	let matches: Command[] = []
	let active = 0
	let selected: Command | undefined
	let editor: ValueControl | undefined
	let previousFocus: HTMLElement | null = null
	let sourceDialog: HTMLDialogElement | null = null

	const collect = () => {
		const scope = sourceDialog ?? root
		commands = [...scope.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)]
			.filter(
				(element) =>
					!dialog.contains(element) &&
					element.id !== "btn-command-palette" &&
					available(element)
			)
			.map((element) => {
				const label = controlLabel(element)
				const context = controlContext(element)
				const choices =
					element instanceof HTMLSelectElement
						? [...element.options].map((option) => option.text).join(" ")
						: ""
				return {
					element,
					label,
					context,
					fields: [label, context, `${element.title} ${element.id} ${choices}`].map(
						commandSearchField
					)
				}
			})
			.filter((command) => command.label)
	}

	const resetEditor = () => {
		selected = undefined
		editor = undefined
		editorPanel.hidden = true
		results.hidden = false
		search.setAttribute("aria-expanded", "true")
	}

	const highlight = () => {
		results.querySelectorAll<HTMLElement>('[role="option"]').forEach((row, index) => {
			row.setAttribute("aria-selected", String(index === active))
			if (index === active) {
				row.scrollIntoView?.({ block: "nearest" })
			}
		})
		if (matches.length) {
			search.setAttribute("aria-activedescendant", `command-result-${active}`)
		} else {
			search.removeAttribute("aria-activedescendant")
		}
	}

	const render = () => {
		const query = normalizeCommandSearch(search.value)
		matches = commands
			.map((command) => ({ command, score: commandSearchScore(query, command.fields) }))
			.filter(({ score }) => Number.isFinite(score))
			.sort((a, b) => a.score - b.score)
			.map(({ command }) => command)
		active = 0
		results.replaceChildren(
			...matches.map((command, index) => {
				const row = root.createElement("div")
				row.id = `command-result-${index}`
				row.setAttribute("role", "option")
				const text = root.createElement("span")
				const label = root.createElement("strong")
				label.textContent = command.label
				const context = root.createElement("small")
				context.textContent = command.context || "Application"
				text.append(label, context)
				const value = root.createElement("span")
				value.className = "command-current-value"
				value.textContent = currentValue(command.element)
				row.append(text, value)
				row.addEventListener(EVENT_CLICK, () => choose(command), options)
				return row
			})
		)
		status.textContent = matches.length
			? `${matches.length} command${matches.length === 1 ? "" : "s"} available`
			: "No matching commands. Try another name or open a device’s controls."
		highlight()
	}

	function choose(command: Command) {
		const element = command.element
		if (!available(element)) {
			collect()
			render()
			return
		}
		if (
			!isValueControl(element) ||
			(element instanceof HTMLInputElement &&
				["checkbox", "radio", "button", "submit", "reset"].includes(element.type))
		) {
			// Close before running actions so native dialogs and permission prompts can open normally.
			dialog.close()
			element.click()
			return
		}
		selected = command
		editor = element.cloneNode(true) as ValueControl
		editor.removeAttribute("id")
		editor.removeAttribute("name")
		editor.removeAttribute("form")
		editor.removeAttribute("autofocus")
		editor.removeAttribute("aria-labelledby")
		editor.removeAttribute("aria-describedby")
		editor.removeAttribute("aria-label")
		editor.removeAttribute("style")
		for (const attribute of Array.from(editor.attributes)) {
			if (attribute.name.startsWith("on")) {
				editor.removeAttribute(attribute.name)
			}
		}
		editor.className = ""
		editor.id = "command-value"
		if (editor instanceof HTMLInputElement && editor.type === "range") {
			editor.type = "number"
			editor.min ||= "0"
			editor.max ||= "100"
			editor.required = true
		}
		editor.value = element.value
		editorLabel.textContent = command.label
		editorHost.replaceChildren(editor)
		results.hidden = true
		editorPanel.hidden = false
		search.setAttribute("aria-expanded", "false")
		search.removeAttribute("aria-activedescendant")
		status.textContent = `Current value: ${currentValue(element)}. Change the value, then Apply.`
		if (editor instanceof HTMLSelectElement) {
			for (const option of editor.options) {
				if (
					option.parentElement instanceof HTMLOptGroupElement &&
					option.parentElement.disabled
				) {
					option.disabled = true
				}
			}
		}
		editor.focus()
	}

	const open = () => {
		if (dialog.open) {
			dialog.close()
			return
		}
		previousFocus = root.activeElement instanceof HTMLElement ? root.activeElement : null
		sourceDialog =
			previousFocus?.closest<HTMLDialogElement>("dialog[open]") ??
			root.querySelector<HTMLDialogElement>("dialog[open]")
		collect()
		resetEditor()
		search.value = ""
		dialog.showModal()
		render()
		search.focus()
	}

	root.defaultView?.addEventListener(
		EVENT_KEY_DOWN,
		(event) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.key.toLowerCase() === "k" &&
				!event.isComposing
			) {
				event.preventDefault()
				event.stopImmediatePropagation()
				if (!event.repeat) {
					open()
				}
			}
		},
		{ ...options, capture: true }
	)
	root.getElementById("btn-command-palette")?.addEventListener(EVENT_CLICK, open, options)
	dialog
		.querySelector("[data-command-close]")!
		.addEventListener(EVENT_CLICK, () => dialog.close(), options)
	dialog.querySelector("[data-command-back]")!.addEventListener(
		EVENT_CLICK,
		() => {
			resetEditor()
			collect()
			render()
			search.focus()
		},
		options
	)
	dialog.addEventListener(
		EVENT_CLICK,
		(event) => {
			if (event.target === dialog) {
				dialog.close()
			}
		},
		options
	)
	dialog.addEventListener(
		EVENT_CANCEL,
		(event) => {
			event.preventDefault()
			dialog.close()
		},
		options
	)
	dialog.addEventListener(
		EVENT_CLOSE,
		() => previousFocus?.isConnected && previousFocus.focus(),
		options
	)
	// Keep typing and navigation away from the musical QWERTY keyboard.
	dialog.addEventListener(EVENT_KEY_UP, (event) => event.stopPropagation(), options)
	dialog.addEventListener(
		EVENT_KEY_DOWN,
		(event) => {
			event.stopPropagation()
			if (event.isComposing) {
				return
			}
			if (event.key === "Escape") {
				event.preventDefault()
				dialog.close()
				return
			}
			if (event.target !== search) {
				return
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault()
				if (matches.length) {
					active =
						(active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
						matches.length
				}
				highlight()
			} else if (event.key === "Enter") {
				event.preventDefault()
				if (matches[active]) {
					choose(matches[active])
				}
			}
		},
		options
	)
	search.addEventListener(
		EVENT_INPUT,
		() => {
			resetEditor()
			collect()
			render()
		},
		options
	)
	dialog.querySelector("form")!.addEventListener(
		EVENT_SUBMIT,
		(event) => {
			event.preventDefault()
			if (!selected || !editor) {
				return
			}
			const target = selected.element as ValueControl
			if (!available(target)) {
				status.textContent = "This control is no longer available. Search again."
				return
			}
			if (!editor.reportValidity()) {
				return
			}
			if (
				target instanceof HTMLSelectElement &&
				![...target.options].some(
					(option) =>
						option.value === editor!.value &&
						!option.disabled &&
						!(
							option.parentElement instanceof HTMLOptGroupElement &&
							option.parentElement.disabled
						)
				)
			) {
				status.textContent = "This choice is no longer available. Search again."
				return
			}
			// Bypass React's value tracker, then use the same events as the original UI.
			const prototype =
				target instanceof HTMLSelectElement
					? HTMLSelectElement.prototype
					: target instanceof HTMLTextAreaElement
						? HTMLTextAreaElement.prototype
						: HTMLInputElement.prototype
			Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(target, editor.value)
			target.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
			target.dispatchEvent(new Event(EVENT_CHANGE, { bubbles: true }))
			target.dispatchEvent(new FocusEvent(EVENT_BLUR))
			target.dispatchEvent(new FocusEvent(EVENT_FOCUS_OUT, { bubbles: true }))
			const label = selected.label
			resetEditor()
			collect()
			render()
			status.textContent = `${label} updated to ${currentValue(target)}.`
			search.focus()
			search.select()
		},
		options
	)
	return open
}