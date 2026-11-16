// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadUIComponent } from "../../../packages/audiobus/ui/components"
import type { CanvasAudioViz } from "../../../packages/audiobus/ui/visualisers/audio-viz/audio-viz"
import type { AudioNodeVisualiser } from "../../../packages/audiobus/ui/shared/audio-node-visualiser"

const context2d = {
	clearRect: vi.fn(),
	fillRect: vi.fn(),
	beginPath: vi.fn(),
	moveTo: vi.fn(),
	lineTo: vi.fn(),
	stroke: vi.fn(),
	setTransform: vi.fn(),
	createLinearGradient: () => ({ addColorStop() {} }),
	fillStyle: "",
	strokeStyle: ""
}
function source() {
	const context = { state: "running", sampleRate: 48000, createAnalyser: vi.fn() }
	const analyser = {
		context,
		fftSize: 512,
		smoothingTimeConstant: 0,
		get frequencyBinCount() {
			return this.fftSize / 2
		},
		getByteFrequencyData: vi.fn((data: Uint8Array) => data.fill(255)),
		getByteTimeDomainData: vi.fn((data: Uint8Array) => data.fill(128)),
		connect: vi.fn(),
		disconnect: vi.fn()
	}
	context.createAnalyser.mockReturnValue(analyser)
	return { context, analyser, connect: vi.fn(), disconnect: vi.fn() }
}
beforeEach(() => {
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context2d as any)
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1)
	)
	vi.stubGlobal("cancelAnimationFrame", vi.fn())
})
afterEach(() => {
	document.body.replaceChildren()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

describe("audio visualiser adapters", () => {
	it.each(["waveform-audio-viz", "spectrum-audio-viz"])(
		"keeps %s silent, resizes FFT data and releases only its taps",
		async (tag) => {
			await loadUIComponent(tag)
			const element = document.createElement(tag) as CanvasAudioViz
			document.body.append(element)
			const first = source(),
				second = source()
			element.connectSource(first.context as any, first as any)
			element.render()
			const read =
				tag === "waveform-audio-viz"
					? first.analyser.getByteTimeDomainData
					: first.analyser.getByteFrequencyData
			expect(read).toHaveBeenCalled()
			expect(read.mock.lastCall![0]).toHaveLength(tag === "waveform-audio-viz" ? 512 : 256)
			element.setAttribute("fft-size", "2048")
			element.render()
			expect(read.mock.lastCall![0]).toHaveLength(tag === "waveform-audio-viz" ? 2048 : 1024)
			expect(first.context.createAnalyser).toHaveBeenCalledTimes(1)
			expect(first.connect).toHaveBeenCalledExactlyOnceWith(first.analyser)
			expect(first.analyser.connect).not.toHaveBeenCalled()
			element.connectSource(second.context as any, second as any)
			expect(first.disconnect).toHaveBeenCalledExactlyOnceWith(first.analyser)
			element.remove()
			expect(second.disconnect).toHaveBeenCalledExactlyOnceWith(second.analyser)
			expect(second.analyser.disconnect).toHaveBeenCalledTimes(1)
		}
	)
	it("releases the standalone spectrum's tap and can reconnect", async () => {
		await loadUIComponent("spectrum-visualiser")
		const element = document.createElement("spectrum-visualiser") as AudioNodeVisualiser
		const audio = source()
		element.audioNode = audio as any
		document.body.append(element)
		await Promise.resolve()
		expect(context2d.fillRect).toHaveBeenCalled()
		expect(audio.analyser.connect).not.toHaveBeenCalled()
		element.remove()
		expect(audio.disconnect).toHaveBeenCalledExactlyOnceWith(audio.analyser)
		document.body.append(element)
		await Promise.resolve()
		expect(audio.context.createAnalyser).toHaveBeenCalledTimes(2)
		element.remove()
		expect(audio.disconnect).toHaveBeenCalledTimes(2)
	})
})