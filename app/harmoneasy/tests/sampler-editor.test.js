// @vitest-environment happy-dom
import { test, expect, vi } from "vitest"
import { setupSamplerEditor } from "../../../packages/audiobus/io/outputs/sampler/sampler-editor.js"
import {
	createSamplerLayer,
	normaliseSamplerLayer
} from "../../../packages/audiobus/io/outputs/sampler/sampler-state.js"

const fixture = () => {
	document.body.innerHTML = '<div id="sampler"></div>'
	const root = document.getElementById("sampler"),
		bank = new Map()
	const backend = {
		getLayers: (key) =>
			bank.get(key) ??
			Array.from({ length: 4 }, () => ({ ...createSamplerLayer(), root: key })),
		updateLayer: vi.fn((key, index, changes) => {
			const layers = backend.getLayers(key)
			layers[index] = normaliseSamplerLayer({ ...layers[index], ...changes })
			bank.set(key, layers)
			return layers[index]
		}),
		clearLayer: vi.fn(),
		loadSample: vi.fn(async () => {}),
		preview: vi.fn(),
		stopPreview: vi.fn()
	}
	const host = { engine: "sampler", backend }
	const editor = setupSamplerEditor(root, () => (host.engine === "sampler" ? host.backend : null))
	editor.refresh()
	return { root, backend, host, editor, bank }
}

test("edits affect the selected layer and key, and sample names are escaped", () => {
	const { root, backend, bank, editor, host } = fixture()
	const key = root.querySelector("[data-sampler-key]")
	key.value = "48"
	key.dispatchEvent(new Event("change", { bubbles: true }))
	root.querySelector('[data-sampler-layer="2"]').click()
	const start = root.querySelector('[data-sampler-param="start"]')
	start.value = "0.25"
	start.dispatchEvent(new Event("change", { bubbles: true }))
	expect(backend.updateLayer).toHaveBeenCalledWith(48, 2, { start: 0.25 })
	const layers = backend.getLayers(48)
	layers[2].name = '<img src=x onerror="alert(1)">'
	layers[2].channels = [new Float32Array(8)]
	layers[2].sampleRate = 48000
	bank.set(48, layers)
	host.engine = "native"
	editor.refresh()
	host.engine = "sampler"
	editor.refresh()
	expect(root.querySelector("img")).toBeNull()
	expect(root.textContent).toContain("<img src=x")
})

test("keyboard audition uses chosen velocity and stops on release or focus loss", () => {
	const { root, backend } = fixture()
	const velocity = root.querySelector("[data-sampler-velocity]")
	velocity.value = "0.4"
	velocity.dispatchEvent(new Event("change", { bubbles: true }))
	const key = root.querySelector('[data-sampler-note="60"]')
	key.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
	expect(backend.preview).toHaveBeenCalledWith(60, 0.4)
	key.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }))
	expect(backend.stopPreview).toHaveBeenCalled()
	key.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
	key.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
	expect(key.classList.contains("playing")).toBe(false)
})

test("drop decodes a sample into the selected slot and reports decode failure", async () => {
	const { root, backend } = fixture()
	root.querySelector('[data-sampler-layer="1"]').click()
	backend.loadSample.mockRejectedValueOnce(Error("Unsupported audio format"))
	const file = { name: "voice.wav" },
		event = new Event("drop", { bubbles: true, cancelable: true })
	Object.defineProperty(event, "dataTransfer", { value: { files: [file] } })
	root.dispatchEvent(event)
	await Promise.resolve()
	await Promise.resolve()
	expect(backend.loadSample).toHaveBeenCalledWith(60, 1, file)
	expect(root.querySelector('[role="status"]').textContent).toBe("Unsupported audio format")
	expect(root.querySelector("[data-sampler-file]").disabled).toBe(false)
})

test("velocity splitting edits only loaded layers", () => {
	const { root, backend } = fixture()
	backend.updateLayer(60, 0, { channels: [new Float32Array(8)] })
	backend.updateLayer(60, 2, { channels: [new Float32Array(8)] })
	root.querySelector('[data-sampler-tab="layer"]').click()
	backend.updateLayer.mockClear()
	root.querySelector("[data-sampler-split]").click()
	expect(backend.updateLayer).toHaveBeenCalledTimes(2)
	expect(backend.getLayers(60)[0].velocityHigh).toBe(0.5)
	expect(backend.getLayers(60)[2].velocityLow).toBe(0.5)
})