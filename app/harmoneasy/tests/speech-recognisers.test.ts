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
	const recorders: { state: string; start(): void; stop(): void }[] = []
	vi.stubGlobal("Worker", class {})
	vi.stubGlobal(
		"MediaRecorder",
		class {
			state = "inactive"
			mimeType = "audio/webm"
			ondataavailable: ((event: { data: Blob }) => void) | null = null
			onstop: (() => void) | null = null
			constructor() {
				recorders.push(this)
			}
			start() {
				this.state = "recording"
			}
			stop() {
				this.state = "inactive"
				this.ondataavailable?.({ data: new Blob(["voice"]) })
				this.onstop?.()
			}
		}
	)
	vi.stubGlobal(
		"AudioContext",
		class {
			decodeAudioData = vi.fn().mockResolvedValue({
				getChannelData: () => new Float32Array([0.1, 0.2])
			})
			close = vi.fn()
		}
	)
	const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
	vi.stubGlobal("navigator", { language: "en-GB", mediaDevices: { getUserMedia } })
	return { track, recorders, getUserMedia }
}

it("records a held phrase and transcribes it with a model in the worker", async () => {
	const media = stubMedia()
	const posted: { kind: string; model: string; id?: number }[] = []
	const worker = {
		onmessage: null as ((event: { data: object }) => void) | null,
		postMessage(message: { kind: string; model: string; id?: number }) {
			posted.push(message)
			if (message.kind === SPEECH_MODEL_TRANSCRIBE) {
				queueMicrotask(() => {
					worker.onmessage!({
						data: { kind: SPEECH_MODEL_PROGRESS, loaded: 1, total: 4 }
					})
					worker.onmessage!({
						data: {
							kind: SPEECH_MODEL_TEXT,
							id: message.id,
							text: "fast jazz on a gamepad"
						}
					})
				})
			}
		}
	}
	const models = createSpeechModelWorker(worker as unknown as Worker)
	const events = handlers()
	const session = modelSpeechRecogniser("moonshine", () => models)!.start(events)
	expect(posted[0]).toEqual({
		kind: SPEECH_MODEL_LOAD,
		model: "onnx-community/moonshine-tiny-ONNX"
	})
	await vi.waitFor(() => expect(media.recorders[0]?.state).toBe("recording"))
	expect(events.onStatus).toHaveBeenLastCalledWith(SPEECH_LISTENING)
	session.stop()
	await vi.waitFor(() => expect(events.onEnd).toHaveBeenCalledOnce())
	expect(events.onText).toHaveBeenCalledWith("fast jazz on a gamepad", true)
	expect(events.onStatus).toHaveBeenCalledWith("Downloading Moonshine Tiny for this device: 25%")
	expect(media.track.stop).toHaveBeenCalled()
	expect(posted[1]).toMatchObject({
		kind: SPEECH_MODEL_TRANSCRIBE,
		model: "onnx-community/moonshine-tiny-ONNX"
	})
})

it("discards an aborted recording and explains blocked microphones", async () => {
	const media = stubMedia()
	const worker = { onmessage: null, postMessage: vi.fn() }
	const models = createSpeechModelWorker(worker as unknown as Worker)
	const aborted = handlers()
	const session = modelSpeechRecogniser("whisper", () => models)!.start(aborted)
	await vi.waitFor(() => expect(media.recorders[0]?.state).toBe("recording"))
	session.abort()
	expect(media.track.stop).toHaveBeenCalled()
	expect(worker.postMessage).toHaveBeenCalledOnce()
	expect(aborted.onEnd).not.toHaveBeenCalled()

	media.getUserMedia.mockRejectedValue(new DOMException("blocked", "NotAllowedError"))
	const blocked = handlers()
	modelSpeechRecogniser("whisper", () => models)!.start(blocked)
	await vi.waitFor(() => expect(blocked.onEnd).toHaveBeenCalledOnce())
	expect(blocked.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("Microphone access"))
})