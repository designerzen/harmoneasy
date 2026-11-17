// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { createPushToTalk, speechRecognitionAvailable } from "../source/libs/push-to-talk"

class FakeRecognition {
	static instances: FakeRecognition[] = []
	lang = ""
	continuous = false
	interimResults = false
	onresult: ((event: unknown) => void) | null = null
	onerror: ((event: { error: string }) => void) | null = null
	onend: (() => void) | null = null
	start = vi.fn()
	stop = vi.fn(() => this.onend?.())
	abort = vi.fn(() => {
		this.onerror?.({ error: "aborted" })
		this.onend?.()
	})
	constructor() {
		FakeRecognition.instances.push(this)
	}
	hear(transcript: string, isFinal: boolean) {
		this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript } }] })
	}
}

afterEach(() => {
	FakeRecognition.instances = []
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

function setup() {
	vi.stubGlobal("webkitSpeechRecognition", FakeRecognition)
	const button = document.createElement("button")
	button.textContent = "Hold to speak"
	document.body.append(button)
	const onStart = vi.fn()
	const onText = vi.fn()
	const onStatus = vi.fn()
	const talk = createPushToTalk(button, { onStart, onText, onStatus })
	const pointer = (type: string) =>
		button.dispatchEvent(new PointerEvent(type, { button: 0, pointerId: 1, bubbles: true }))
	const key = (type: string, key = " ") =>
		button.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }))
	return { button, talk, onStart, onText, onStatus, pointer, key }
}

it("records only while the button is held and reports the settled transcript", () => {
	const ui = setup()
	expect(speechRecognitionAvailable()).toBe(true)
	ui.pointer("pointerdown")
	const recognition = FakeRecognition.instances[0]
	expect(recognition.start).toHaveBeenCalledOnce()
	expect(recognition.continuous).toBe(true)
	expect(ui.onStart).toHaveBeenCalledOnce()
	expect(ui.button.getAttribute("aria-pressed")).toBe("true")
	recognition.hear("slow jazz", true)
	recognition.hear("with my", false)
	expect(ui.onText).toHaveBeenLastCalledWith("slow jazz with my", false)
	recognition.hear("with my gamepad", true)
	ui.pointer("pointerup")
	ui.button.click()
	expect(recognition.stop).toHaveBeenCalledOnce()
	expect(ui.onText).toHaveBeenLastCalledWith("slow jazz with my gamepad", true)
	expect(ui.button.getAttribute("aria-pressed")).toBe("false")
	expect(ui.button.textContent).toBe("Hold to speak")
	expect(FakeRecognition.instances).toHaveLength(1)
})

it("holds with Space or Enter and toggles on a plain click for assistive technology", () => {
	const ui = setup()
	ui.key("keydown", "Enter")
	ui.key("keydown", "Enter")
	expect(FakeRecognition.instances).toHaveLength(1)
	ui.key("keyup", "Enter")
	expect(FakeRecognition.instances[0].stop).toHaveBeenCalledOnce()
	ui.button.click()
	expect(FakeRecognition.instances).toHaveLength(2)
	ui.button.click()
	expect(FakeRecognition.instances[1].stop).toHaveBeenCalledOnce()
})

it("explains recognition errors and silently discards aborted speech", () => {
	const ui = setup()
	ui.pointer("pointerdown")
	FakeRecognition.instances[0].onerror?.({ error: "not-allowed" })
	expect(ui.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("Microphone access"))
	ui.onStatus.mockClear()
	ui.pointer("pointerup")
	ui.pointer("pointerdown")
	FakeRecognition.instances[1].hear("techno", false)
	ui.talk.abort()
	expect(ui.onStatus).not.toHaveBeenCalledWith(expect.stringContaining("unexpectedly"))
	expect(ui.onText).not.toHaveBeenCalledWith(expect.anything(), true)
	expect(ui.button.getAttribute("aria-pressed")).toBe("false")
})