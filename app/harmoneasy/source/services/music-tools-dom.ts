import { EVENT_CLICK, EVENT_CHANGE } from "audiobus/event-constants"
export function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	text = ""
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag)
	node.textContent = text
	return node
}
export function action(
	label: string,
	run: () => unknown | Promise<unknown>,
	status: HTMLElement
): HTMLButtonElement {
	const button = element("button", label)
	button.type = "button"
	button.addEventListener(EVENT_CLICK, async () => {
		button.disabled = true
		try {
			await run()
		} catch (error) {
			status.textContent = error instanceof Error ? error.message : String(error)
		} finally {
			button.disabled = false
		}
	})
	return button
}
export function field<T extends HTMLElement>(host: HTMLElement, name: string, control: T): T {
	const label = element("label")
	label.append(name, control)
	host.append(label)
	return control
}
export function numberField(
	host: HTMLElement,
	label: string,
	value: number,
	min: number,
	max: number,
	step = 1
): HTMLInputElement {
	const control = element("input")
	control.type = "number"
	control.min = String(min)
	control.max = String(max)
	control.step = String(step)
	control.value = String(value)
	return field(host, label, control)
}
export function selectField(
	host: HTMLElement,
	label: string,
	choices: { name: string; value: string }[],
	selected?: string
): HTMLSelectElement {
	const select = element("select")
	for (const choice of choices) {
		const option = element("option", choice.name)
		option.value = choice.value
		select.append(option)
	}
	if (selected !== undefined) {
		select.value = selected
	}
	return field(host, label, select)
}
export function section(host: HTMLElement, title: string): HTMLElement {
	const details = element("details")
	details.append(element("summary", title))
	const body = element("div")
	body.className = "music-tools-section"
	details.append(body)
	host.append(details)
	return body
}
export function download(data: BlobPart, name: string, type = "application/octet-stream"): void {
	const url = URL.createObjectURL(new Blob([data], { type }))
	const link = element("a")
	link.href = url
	link.download = name
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 30000)
}
export function onChange(control: HTMLElement, run: () => void): void {
	control.addEventListener(EVENT_CHANGE, run)
}