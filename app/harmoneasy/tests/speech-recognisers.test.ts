// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import {
	browserSpeechRecogniser,
	createSpeechModelWorker,
	listSpeechRecognisers,
	modelSpeechRecogniser,
	SPEECH_LISTENING
} from "../source/libs/speech-recognisers"
import {
	SPEECH_MODEL_LOAD,
	SPEECH_MODEL_PROGRESS,
	SPEECH_MODEL_TEXT,
	SPEECH_MODEL_TRANSCRIBE
} from "../source/libs/speech-model-messages"

function stubBrowserRecognition(state: string) {
	const instances: { processLocally?: boolean; start: () => void }[] = []
	let finishInstall!: (ready: boolean) => void
	const Recognition = Object.assign(
		class {
			processLocally?: boolean
			onend: (() => void) | null = null
			start = vi.fn()
			stop = vi.fn(() => this.onend?.())
			abort = vi.fn()
			constructor() {
				instances.push(this)
			}
		},
		{
			available: vi.fn().mockResolvedValue(state),
			install: vi.fn(
				() =>
					new Promise<boolean>((resolve) => {
						finishInstall = resolve
					})
			)
		}
	)
	vi.stubGlobal("webkitSpeechRecognition", Recognition)
	return { Recognition, instances, finishInstall: (ready: boolean) => finishInstall(ready) }
}

function handlers() {
	return { onText: vi.fn(), onStatus: vi.fn(), onEnd: vi.fn() }
}

afterEach(() => {
	vi.unstubAllGlobals()
})

it("asks the browser to keep recognition on this device once its language pack is ready", async () => {
	const browser = stubBrowserRecognition("available")
	const events = handlers()
	const session = browserSpeechRecogniser(true)!.start(events)
	await vi.waitFor(() => expect(browser.instances).toHaveLength(1))
	expect(browser.instances[0].processLocally).toBe(true)
	expect(browser.instances[0].start).toHaveBeenCalledOnce()
	expect(events.onStatus).toHaveBeenLastCalledWith(SPEECH_LISTENING)
	session.stop()
	expect(events.onEnd).toHaveBeenCalledOnce()
})

it("installs a missing language pack once, then asks for the phrase again", async () => {
	const browser = stubBrowserRecognition("downloadable")
	const first = handlers()
	browserSpeechRecogniser(true, false)!.start(first)
	await vi.waitFor(() => expect(first.onEnd).toHaveBeenCalledOnce())
	expect(first.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("about 60 MB"))
	expect(browser.Recognition.install).toHaveBeenCalledWith({
		langs: [expect.stringMatching(/^en/)],
		processLocally: true
	})
	const second = handlers()
	browserSpeechRecogniser(true, false)!.start(second)
	await vi.waitFor(() => expect(second.onEnd).toHaveBeenCalledOnce())
	expect(browser.Recognition.install).toHaveBeenCalledOnce()
	expect(browser.instances).toHaveLength(0)
	browser.finishInstall(true)
	await vi.waitFor(() =>
		expect(first.onStatus).toHaveBeenLastCalledWith(
			expect.stringContaining("ready on this device")
		)
	)
})

it("offers on-device options first and the online service last", async () => {
	stubBrowserRecognition("available")
	expect((await listSpeechRecognisers()).map((item) => item.id)).toEqual([
		"browser-device",
		"browser-online"
	])
	stubMedia()
	expect((await listSpeechRecognisers()).map((item) => item.id)).toEqual([
		"browser-device",
		"moonshine",
		"whisper",
		"browser-online"
	])
	stubBrowserRecognition("downloadable")
	const list = await listSpeechRecognisers()
	expect(list.map((item) => item.id)).toEqual([
		"moonshine",
		"whisper",
		"browser-device",
		"browser-online"
	])
	expect(list.every((item) => item.onDevice === (item.id !== "browser-online"))).toBe(true)
	expect(list[3].label).toContain("sends your voice")
	vi.stubGlobal("webkitSpeechRecognition", undefined)
	expect((await listSpeechRecognisers()).map((item) => item.id)).toEqual(["moonshine", "whisper"])
})

function stubMedia() {
	const track = { stop: vi.fn() }
	const nodes: { port: { onmessage: ((event: { data: Float32Array }) => void) | null } }[] = []
	const contexts: { close: () => void }[] = []
	vi.stubGlobal("Worker", class {})
	vi.stubGlobal(
		"AudioContext",
		class {
			sampleRate = 16000
			audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
			close = vi.fn().mockResolvedValue(undefined)
			constructor() {
				contexts.push(this)
			}
			createMediaStreamSource() {
				return { connect: vi.fn() }
			}
		}
	)
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { onmessage: null }
			constructor() {
				nodes.push(this)
			}
		}
	)
	const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
	vi.stubGlobal("navigator", { language: "en-GB", mediaDevices: { getUserMedia } })
	/** Sends `seconds` of a loud tone, as the capture worklet would, in 20 ms chunks. */
	const speak = async (seconds: number, level = 0.3) => {
		for (let i = 0; i < seconds * 50; i++) {
			nodes.at(-1)!.port.onmessage!({
				data: Float32Array.from({ length: 320 }, (_, index) => level * Math.sin(index / 3))
			})
			await Promise.resolve()
		}
	}
	return { track, nodes, contexts, getUserMedia, speak }
}

function fakeModelWorker(
	reply: (message: { kind: string; id?: number; audio?: Float32Array }) => object[]
) {
	const posted: { kind: string; model: string; id?: number; audio?: Float32Array }[] = []
	const worker = {
		onmessage: null as ((event: { data: object }) => void) | null,
		postMessage(message: { kind: string; model: string; id?: number; audio?: Float32Array }) {
			posted.push(message)
			queueMicrotask(() => reply(message).forEach((data) => worker.onmessage!({ data })))
		}
	}
	return { posted, models: createSpeechModelWorker(worker as unknown as Worker) }
}

it("shows a model's text while the person speaks and finishes quickly on release", async () => {
	const media = stubMedia()
	const { posted, models } = fakeModelWorker((message) =>
		message.kind === SPEECH_MODEL_TRANSCRIBE
			? [
					{ kind: SPEECH_MODEL_PROGRESS, loaded: 1, total: 4 },
					{
						kind: SPEECH_MODEL_TEXT,
						id: message.id,
						text: `heard ${Math.round(message.audio!.length / 16000)} seconds`
					}
				]
			: []
	)
	const events = handlers()
	const session = modelSpeechRecogniser("moonshine", () => models)!.start(events)
	expect(posted[0]).toEqual({
		kind: SPEECH_MODEL_LOAD,
		model: "onnx-community/moonshine-tiny-ONNX"
	})
	await vi.waitFor(() => expect(media.nodes).toHaveLength(1))
	expect(events.onStatus).toHaveBeenLastCalledWith(SPEECH_LISTENING)
	await media.speak(2)
	await vi.waitFor(() => expect(events.onText).toHaveBeenCalledWith("heard 2 seconds", false))
	expect(events.onEnd).not.toHaveBeenCalled()
	await media.speak(0.3, 0)
	const passes = posted.filter((message) => message.kind === SPEECH_MODEL_TRANSCRIBE).length
	session.stop()
	expect(media.track.stop).toHaveBeenCalled()
	await vi.waitFor(() => expect(events.onEnd).toHaveBeenCalledOnce())
	expect(events.onText).toHaveBeenLastCalledWith("heard 2 seconds", true)
	expect(posted.filter((message) => message.kind === SPEECH_MODEL_TRANSCRIBE)).toHaveLength(
		passes
	)
	expect(events.onStatus).toHaveBeenCalledWith("Downloading Moonshine Tiny for this device: 25%")
	expect(media.contexts[0].close).toHaveBeenCalled()
})

it("discards an aborted recording and explains blocked microphones", async () => {
	const media = stubMedia()
	const { posted, models } = fakeModelWorker(() => [])
	const aborted = handlers()
	const session = modelSpeechRecogniser("whisper", () => models)!.start(aborted)
	await vi.waitFor(() => expect(media.nodes).toHaveLength(1))
	session.abort()
	await media.speak(1)
	expect(media.track.stop).toHaveBeenCalled()
	expect(posted).toHaveLength(1)
	expect(aborted.onEnd).not.toHaveBeenCalled()

	media.getUserMedia.mockRejectedValue(new DOMException("blocked", "NotAllowedError"))
	const blocked = handlers()
	modelSpeechRecogniser("whisper", () => models)!.start(blocked)
	await vi.waitFor(() => expect(blocked.onEnd).toHaveBeenCalledOnce())
	expect(blocked.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("Microphone access"))
})

it("warms up a model only when it is already downloaded", async () => {
	stubMedia()
	const { posted, models } = fakeModelWorker(() => [])
	const match = vi.fn().mockResolvedValue(undefined)
	vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue({ match }) })
	modelSpeechRecogniser("moonshine", () => models)!.prepare!()
	await vi.waitFor(() => expect(match).toHaveBeenCalledOnce())
	expect(match.mock.calls[0][0]).toContain(
		"moonshine-tiny-ONNX/resolve/main/onnx/encoder_model_quantized"
	)
	expect(posted).toHaveLength(0)
	match.mockResolvedValue(new Response("cached"))
	modelSpeechRecogniser("moonshine", () => models)!.prepare!()
	await vi.waitFor(() =>
		expect(posted).toEqual([
			{ kind: SPEECH_MODEL_LOAD, model: "onnx-community/moonshine-tiny-ONNX" }
		])
	)
})