export function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className = "",
	text = ""
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag)
	if (className) {
		node.className = className
	}
	if (text) {
		node.textContent = text
	}
	return node
}
export function button(text: string, action: () => void, className = "") {
	const node = element("button", className, text)
	node.type = "button"
	node.onclick = action
	return node
}
export function icon(src: string, title = "") {
	const node = element("span", "element-icon")
	node.setAttribute("aria-hidden", "true")
	node.title = title
	node.style.maskImage = `url("${src}")`
	return node
}
export interface NativeView {
	element: HTMLElement
	destroy(): void
}
export function option(text: string, value: string) {
	const node = element("option", "", text)
	node.value = value
	return node
}