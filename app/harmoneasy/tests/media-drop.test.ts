// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { installMediaDrop } from "../source/services/media-drop"

const controllers: AbortController[] = []
afterEach(() => {
	controllers.splice(0).forEach((controller) => controller.abort())
	document.body.replaceChildren()
})
function setup() {
	const receive = vi.fn(),
		controller = new AbortController()
	controllers.push(controller)
	installMediaDrop(document, receive, controller.signal)
	const graph = document.createElement("div")
	document.body.append(graph)
	return { receive, graph, controller }
}
function drag(target: Element, type: string, transfer: object) {
	const event = new Event(type, { bubbles: true, cancelable: true })
	Object.defineProperty(event, "dataTransfer", {
		value: { files: [], getData: () => "", ...transfer }
	})
	target.dispatchEvent(event)
	return event
}

it("loads every file even over graph nodes that intercept drops and clears the highlight", () => {
	const { receive, graph } = setup()
	const intercept = vi.fn((event) => event.stopPropagation())
	graph.addEventListener("drop", intercept)
	drag(graph, "dragover", { types: ["Files"] })
	expect(document.body.classList.contains("drag-over")).toBe(true)
	const files = [new File(["midi"], "one.mid"), new File(["zip"], "synth.zip")]
	const event = drag(graph, "drop", { types: ["Files"], files })
	expect(event.defaultPrevented).toBe(true)
	expect(receive.mock.calls).toEqual(files.map((file) => [file]))
	expect(intercept).not.toHaveBeenCalled()
	expect(document.body.classList.contains("drag-over")).toBe(false)
})
it("accepts URL drags but leaves internal graph drops alone", () => {
	const { receive, graph } = setup()
	const internal = drag(graph, "drop", { types: ["text/plain"], getData: () => "graph-node-123" })
	expect(internal.defaultPrevented).toBe(false)
	expect(receive).not.toHaveBeenCalled()
	drag(graph, "drop", {
		types: ["text/uri-list"],
		getData: () => "https://example.com/plugin/index.js"
	})
	expect(receive).toHaveBeenCalledWith("https://example.com/plugin/index.js")
})
it("removes handlers and highlight when the UI is destroyed", () => {
	const { receive, graph, controller } = setup()
	drag(graph, "dragover", { types: ["Files"] })
	controller.abort()
	expect(document.body.classList.contains("drag-over")).toBe(false)
	drag(graph, "drop", { types: ["Files"], files: [new File([""], "song.mid")] })
	expect(receive).not.toHaveBeenCalled()
})