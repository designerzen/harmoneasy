// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { VoiceWorkshopVoice } from "audiobus-output-voice-workshop/voice-workshop.worklet.js"
import OutputVoiceWorkshop, {
	EVENT_CONFIGURATION_CHANGED
} from "audiobus-output-voice-workshop/output"
import { DEFAULT_SETTINGS } from "audiobus-output-voice-workshop/settings"
import { VOICE_WORKSHOP_OUTPUT_ID } from "audiobus-output-voice-workshop"
import { getOutputDefinition } from "audiobus/io/output-definitions"

const FS = 48000

function render(voice: InstanceType<typeof VoiceWorkshopVoice>, seconds: number) {
	const out = new Float32Array(Math.round(seconds * FS))
	for (let offset = 0; offset < out.length; offset += 128) {
		const block = new Float32Array(Math.min(128, out.length - offset))
		voice.process(block)
		out.set(block, offset)
	}
	return out
}
const rms = (x: Float32Array) => Math.sqrt(x.reduce((sum, y) => sum + y * y, 0) / x.length)
function pitch(x: Float32Array) {
	let best = 0,
		lag = 0
	for (let l = Math.floor(FS / 1000); l < FS / 60; l++) {
		let c = 0
		for (let i = 0; i < 4096; i++) {
			c += x[i] * x[i + l]
		}
		if (c > best) {
			best = c
			lag = l
		}
	}
	return FS / lag
}
// energy of the second formant of [i] (1.8-3 kHz) against the first formants (150 Hz-1 kHz), dB
function frontness(x: Float32Array) {
	const N = 4096
	const band = (lo: number, hi: number) => {
		let energy = 0
		for (let f = lo; f <= hi; f += FS / N) {
			let re = 0,
				im = 0
			for (let n = 0; n < N; n++) {
				const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N)) * x[n]
				re += w * Math.cos((2 * Math.PI * f * n) / FS)
				im -= w * Math.sin((2 * Math.PI * f * n) / FS)
			}
			energy += re * re + im * im
		}
		return energy
	}
	return 10 * Math.log10(band(1800, 3000) / band(150, 1000))
}

describe("Voice Workshop engine", () => {
	it("sings a note on its pitch, glides legato and falls silent after release", () => {
		const voice = new VoiceWorkshopVoice(FS)
		voice.noteOn(220, 0.8)
		const held = render(voice, 0.6).subarray(FS * 0.3)
		expect(held.every(Number.isFinite)).toBe(true)
		expect(rms(held)).toBeGreaterThan(0.03)
		expect(Math.abs(pitch(held) - 220)).toBeLessThan(4)

		voice.noteOn(330, 0.8, undefined, true)
		const glided = render(voice, 0.5).subarray(FS * 0.3)
		expect(Math.abs(pitch(glided) - 330)).toBeLessThan(6)

		voice.release()
		const tail = render(voice, 0.6).subarray(FS * 0.4)
		expect(rms(tail)).toBeLessThan(0.005)
		render(voice, 2)
		expect(voice.sounding).toBe(false)
	}, 30000)

	it("shapes the vowel from the pad", () => {
		const voice = new VoiceWorkshopVoice(FS)
		const vowel = (vowelX: number, vowelY: number) => {
			voice.configure({ ...DEFAULT_SETTINGS, voice: "man", vowelX, vowelY })
			voice.noteOn(120, 0.8)
			const sound = render(voice, 0.5).subarray(FS * 0.25)
			voice.panic()
			return frontness(sound)
		}
		expect(vowel(0, 0)).toBeGreaterThan(vowel(1, 0) + 10) // [i] against [u]
	}, 30000)
})

describe("Voice Workshop output", () => {
	afterEach(() => vi.unstubAllGlobals())

	function output(options = {}) {
		const posted: any[] = []
		vi.stubGlobal(
			"AudioWorkletNode",
			class {
				port = { postMessage: (m: unknown) => posted.push(m), close() {}, onmessage: null }
				connect() {}
				disconnect() {}
			}
		)
		const gain = () => ({ connect() {}, disconnect() {}, gain: { value: 1 } })
		const audioContext = {
			state: "running",
			destination: {},
			createGain: gain,
			audioWorklet: { addModule: vi.fn(async () => {}) }
		} as unknown as AudioContext
		const device = new OutputVoiceWorkshop({ audioContext, ...options })
		return { device, posted, audioContext }
	}

	it("plays one note at a time, gliding back to notes still held", async () => {
		const { device, posted } = output({ vowelMode: "pitch" })
		await device.connect()
		await device.noteOn(60, 127)
		await device.noteOn(67, 64)
		device.noteOff(67)
		await Promise.resolve()
		device.noteOff(60)
		await Promise.resolve()
		const notes = posted.filter((m) => m.type !== "settings")
		expect(notes.map((m) => m.type)).toEqual(["note", "note", "note", "release"])
		expect(notes[0]).toMatchObject({ legato: false, velocity: 1 })
		expect(notes[0].frequency).toBeCloseTo(261.63, 1)
		expect(notes[1]).toMatchObject({ legato: true, vowel: { x: 1, y: 0.66 } }) // G: [ɔ]
		expect(notes[2].frequency).toBeCloseTo(261.63, 1)
		expect(notes[2].legato).toBe(true)
		expect(device.heldNotes).toEqual([])
	})

	it("keeps settings in range and tells listeners", async () => {
		const { device, posted } = output()
		await device.connect()
		const changed = vi.fn()
		device.addEventListener(EVENT_CONFIGURATION_CHANGED, changed)
		device.configure({ volume: 99, voice: "nobody", transpose: -12 })
		expect(device.options).toMatchObject({
			volume: 12,
			voice: DEFAULT_SETTINGS.voice,
			transpose: -12
		})
		expect(changed).toHaveBeenCalledOnce()
		expect(posted.at(-1)).toMatchObject({ type: "settings", settings: { volume: 12 } })
		await device.noteOn(69, 100)
		expect(posted.at(-1).frequency).toBeCloseTo(220)
	})

	it("describes every control it can read and write", () => {
		const { device } = output()
		const { controls } = device.getUiDescriptor()
		for (const control of controls) {
			expect(device.getControlValue(control.id), control.id).toBeDefined()
		}
		device.setControlValue("vowel", [0.2, 0.3])
		expect(device.getControlValue("vowel")).toEqual([0.2, 0.3])
	})

	it("draws a GUI whose controls configure the voice", async () => {
		const { device } = output()
		const element = await device.createGui()
		const root = element.shadowRoot!
		const voice = root.querySelector<HTMLSelectElement>("select[name=voice]")!
		expect(voice.options.length).toBeGreaterThan(10)
		voice.value = "child"
		voice.dispatchEvent(new Event("change"))
		expect(device.options.voice).toBe("child")
		const glide = root.querySelector<HTMLInputElement>("input[name=glide]")!
		glide.value = "250"
		glide.dispatchEvent(new Event("input"))
		expect(device.options.glide).toBe(250)
		root.querySelector<HTMLButtonElement>("button[value=cycle]")!.click()
		expect(device.options.vowelMode).toBe("cycle")
		await device.destroyGui()
	})

	it("is registered with audiobus", () => {
		expect(getOutputDefinition(VOICE_WORKSHOP_OUTPUT_ID)?.name).toBe("Voice Workshop")
	})
})