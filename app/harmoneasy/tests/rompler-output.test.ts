// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { readFileSync } from "fs"
import Rompler from "../../../packages/audiobus/io/outputs/rompler/output-rompler"
import {
	ROMPLER_HOST,
	noteName,
	sampleGrid,
	sampleUrl
} from "../../../packages/audiobus/io/outputs/rompler/rompler-catalogue"
import { defineDevice, deviceDefinition } from "../../../packages/audiobus/io/device-definition"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import {
	NOTE_ON,
	NOTE_OFF,
	PROGRAM_CHANGE,
	CONTROL_CHANGE
} from "../../../packages/audiobus/commands/commands"

const outputs: Rompler[] = []
afterEach(() => {
	outputs.splice(0).forEach((output) => output.destroy())
	vi.unstubAllGlobals()
})
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const fixture = (
	options: Record<string, any> = {},
	audio = { sampleRate: 48000, data: new Float32Array([0, 0.5, 1, -1]) }
) => {
	const nodes: any[] = []
	const requests: { url: string; signal: AbortSignal; resolve: () => void }[] = []
	vi.stubGlobal(
		"AudioWorkletNode",
		class {
			port = { postMessage: vi.fn(), close: vi.fn() }
			connect = vi.fn()
			disconnect = vi.fn()
			constructor() {
				nodes.push(this)
			}
		}
	)
	vi.stubGlobal(
		"fetch",
		vi.fn(
			(url: string, init?: RequestInit) =>
				new Promise((resolve) =>
					requests.push({
						url,
						signal: init?.signal as AbortSignal,
						resolve: () =>
							resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })
					})
				)
		)
	)
	const context = {
		currentTime: 0,
		state: "running",
		destination: {},
		audioWorklet: { addModule: vi.fn(async () => {}) },
		resume: vi.fn(async () => {}),
		createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
		decodeAudioData: vi.fn(async () => ({
			length: audio.data.length,
			sampleRate: audio.sampleRate,
			numberOfChannels: 2,
			getChannelData: () => audio.data
		}))
	}
	const output = new Rompler({ ...options, audioContext: context })
	outputs.push(output)
	return { output, nodes, requests }
}
const cmd = (type: string, number = 60, value = 0) =>
	musicalCommand({ type, number, value, channel: 1, velocity: 127 })
const notes = (requests: { url: string }[]) =>
	requests.map(({ url }) => url.slice(url.lastIndexOf("/") + 1, -4))

it("maps the GM catalogue onto OpenGM24 URLs", () => {
	expect(noteName(21)).toBe("A0")
	expect(noteName(61)).toBe("Db4")
	expect(noteName(108)).toBe("C8")
	expect(sampleGrid(1)).toHaveLength(88)
	expect(sampleGrid(3)).toContain(60)
	expect(sampleUrl(ROMPLER_HOST, 24, 60)).toBe(
		"https://designerzen.github.io/Open-GeneralMIDI-SoundFont/OpenGM24/acoustic_guitar_nylon-mp3/C4.mp3"
	)
})

it("registers, persists its preset and downloads nothing until requested", async () => {
	const { output, requests } = fixture({ preset: 40, spacing: 2 })
	const { OUTPUT_FACTORIES } = await import("../../../packages/audiobus/io/output-factory")
	expect(OUTPUT_FACTORIES.find((factory) => factory.id === "rompler")?.isAvailable()).toBe(true)
	defineDevice(output, { factory: "output", type: "rompler" })
	const saved = JSON.parse(JSON.stringify(deviceDefinition(output)))
	expect(saved.options).toMatchObject({ preset: 40, spacing: 2 })
	expect(saved.options.pack).toBeUndefined()
	expect(saved.options.audioContext).toBeUndefined()
	await output.createGui()
	expect(requests.filter(({ url }) => url.endsWith(".mp3"))).toHaveLength(0)
})

it("browses instruments from the catalogue and lights keys as samples land", async () => {
	const { output, requests } = fixture({ spacing: 1 })
	const gui = await output.createGui()
	const items = [...gui.querySelectorAll<HTMLButtonElement>(".rompler-item")]
	expect(items).toHaveLength(128)
	expect(gui.querySelector(".rompler-title")?.textContent).toBe("Acoustic Grand Piano")
	const search = gui.querySelector<HTMLInputElement>(".rompler-search")!
	search.value = "bass"
	search.dispatchEvent(new Event("input"))
	const shown = items.filter((item) => !item.hidden)
	expect(shown.length).toBeGreaterThan(0)
	expect(shown.every((item) => /bass/i.test(item.textContent!))).toBe(true)
	shown[0].click()
	expect(output.options.preset).toBe(32)
	expect(gui.querySelector(".rompler-title")?.textContent).toBe("Acoustic Bass")
	expect(items[32].getAttribute("aria-pressed")).toBe("true")
	await output.sendCommand(cmd(NOTE_ON, 72))
	expect(gui.querySelector('[data-note="72"]')?.classList.contains("playing")).toBe(true)
	requests.find(({ url }) => url.endsWith("/C5.mp3"))!.resolve()
	await flush()
	expect(gui.querySelector('[data-note="72"]')?.classList.contains("loaded")).toBe(true)
	await output.sendCommand(cmd(NOTE_OFF, 72))
	expect(gui.querySelector('[data-note="72"]')?.classList.contains("playing")).toBe(false)
})

it("loads outward from the played register with bounded concurrency", async () => {
	const { output, nodes, requests } = fixture({ spacing: 1 })
	await output.sendCommand(cmd(NOTE_ON, 72))
	expect(requests).toHaveLength(6)
	expect(notes(requests)[0]).toBe("C5")
	expect(nodes[0].port.postMessage).toHaveBeenCalledWith({
		type: "on",
		channel: 0,
		note: 72,
		velocity: 1
	})
	requests[0].resolve()
	await flush()
	const [message, transfer] = nodes[0].port.postMessage.mock.calls.find(
		([data]: any[]) => data.type === "sample"
	)
	// Identical stereo collapses to mono 16-bit PCM and is transferred, not copied
	expect(message.note).toBe(72)
	// Scaled by the end fade, so one-shots never click off
	expect(Array.from(message.channels[0])).toEqual([0, 102, 136, -68])
	expect(message.loopEnd).toBeUndefined()
	expect(transfer).toEqual([message.channels[0].buffer])
	expect(requests).toHaveLength(7)
})

it("loops sustained presets with the crossfade baked into the sample", async () => {
	const sampleRate = 8000
	const data = new Float32Array(Math.round(3.13 * sampleRate)).map((_, i) =>
		Math.sin((i * 2 * Math.PI) / 100)
	)
	const { output, nodes, requests } = fixture({ preset: 48 }, { sampleRate, data })
	await output.connect()
	requests[0].resolve()
	await flush()
	const [message] = nodes[0].port.postMessage.mock.calls.find(
		([data]: any[]) => data.type === "sample"
	)
	const [pcm] = message.channels
	expect(message.loopStart).toBe(sampleRate)
	// The end lands on the cycle that best continues the loop start
	expect((message.loopEnd - message.loopStart) % 100).toBe(0)
	expect(pcm).toHaveLength(message.loopEnd)
	expect(pcm[pcm.length - 1] / 32767).toBeCloseTo(data[message.loopStart - 1], 2)
})

it("switches presets by cancelling downloads and keeps old samples until new ones land", async () => {
	const { output, nodes, requests } = fixture()
	await output.connect()
	requests[0].resolve()
	await flush()
	const port = nodes[0].port.postMessage
	expect(port.mock.calls.filter(([data]: any[]) => data.type === "clear")).toHaveLength(1)
	const first = requests.slice()
	await output.sendCommand(cmd(PROGRAM_CHANGE, 0, 33))
	expect(output.options.preset).toBe(33)
	expect(first.every(({ signal }) => signal.aborted)).toBe(true)
	expect(requests[first.length].url).toContain("/electric_bass_finger-mp3/")
	expect(port.mock.calls.filter(([data]: any[]) => data.type === "clear")).toHaveLength(1)
	requests[first.length].resolve()
	await flush()
	expect(port.mock.calls.filter(([data]: any[]) => data.type === "clear")).toHaveLength(2)
})

it("holds sustained notes until the pedal lifts", async () => {
	const { output, nodes } = fixture()
	await output.sendCommand(cmd(NOTE_ON, 60))
	await output.sendCommand(
		musicalCommand({ type: CONTROL_CHANGE, number: 64, value: 127, channel: 1 })
	)
	await output.sendCommand(cmd(NOTE_OFF, 60))
	const port = nodes[0].port.postMessage
	expect(port).not.toHaveBeenCalledWith({ type: "off", channel: 0, note: 60 })
	await output.sendCommand(
		musicalCommand({ type: CONTROL_CHANGE, number: 64, value: 0, channel: 1 })
	)
	expect(port).toHaveBeenCalledWith({ type: "off", channel: 0, note: 60 })
})

const worklet = () => {
	const clock = { time: 0 }
	const source = readFileSync(
		"../../packages/audiobus/io/outputs/rompler/rompler.worklet.js",
		"utf8"
	)
	const Processor = new Function(
		"AudioWorkletProcessor",
		"sampleRate",
		"clock",
		source
			.replace(/\bcurrentTime\b/g, "clock.time")
			.replace(/registerProcessor\([^\n]+/, "return RomplerProcessor")
	)(
		class {
			port = {}
		},
		48000,
		clock
	)
	const processor = new Processor()
	const send = (data: object) => processor.port.onmessage({ data })
	const render = () => {
		const outputs = [[new Float32Array(128), new Float32Array(128)]]
		processor.process([], outputs)
		clock.time += 128 / 48000
		return outputs[0][0]
	}
	return { processor, send, render, clock }
}

it("plays held notes once the first sample arrives, pitched from the nearest key", () => {
	const { processor, send, render } = worklet()
	send({ type: "on", channel: 0, note: 62, velocity: 1 })
	expect(render().some(Boolean)).toBe(false)
	send({ type: "sample", note: 60, channels: [new Int16Array(48000).fill(16384)] })
	expect(processor.voices[0].rate).toBeCloseTo(2 ** (2 / 12))
	expect(render()[127]).toBeCloseTo(0.5, 2)
	// Looped voices outlast their sample until released
	send({
		type: "sample",
		note: 64,
		channels: [new Int16Array(200).fill(16384)],
		loopStart: 100,
		loopEnd: 200
	})
	send({ type: "on", channel: 0, note: 64, velocity: 1 })
	for (let i = 0; i < 4; i++) {
		render()
	}
	expect(processor.voices.map(({ note }: any) => note)).toEqual([62, 64])
	expect(processor.voices[1].position).toBeLessThan(200)
	send({ type: "off", channel: 0, note: 64 })
	send({ type: "off", channel: 0, note: 62 })
	send({ type: "release", value: 0.001 })
	render()
	render()
	expect(processor.voices).toHaveLength(0)
})
it("holds notes and releases timed for later until the worklet reaches them, and panic drops them", async () => {
	const { processor, send, render, clock } = worklet()
	send({ type: "sample", note: 60, channels: [new Int16Array(48000).fill(16384)] })
	send({ type: "on", channel: 0, note: 60, velocity: 1, time: 0.01 })
	send({ type: "off", channel: 0, note: 60, time: 0.02 })
	expect(render().some(Boolean)).toBe(false)
	while (clock.time < 0.01) {
		render()
	}
	expect(render().some(Boolean)).toBe(true)
	expect(processor.voices[0].releasing).toBe(false)
	while (clock.time < 0.02) {
		render()
	}
	render()
	expect(processor.voices[0].releasing).toBe(true)
	send({ type: "on", channel: 0, note: 62, velocity: 1, time: 1 })
	send({ type: "panic" })
	expect(processor.events).toHaveLength(0)

	const { output, nodes } = fixture()
	await output.sendCommand(
		musicalCommand({ type: NOTE_ON, number: 60, velocity: 127, channel: 1, audioTime: 2 })
	)
	expect(nodes[0].port.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({ type: "on", note: 60, time: 2 })
	)
})
// A two-zone SoundFont 2 bank: a looped low sample and a quieter, decaying high one
const testBank = (): ArrayBuffer => {
	const ascii = (text: string, size = text.length) => {
		const bytes = new Uint8Array(size)
		for (let i = 0; i < Math.min(size, text.length); i++) {
			bytes[i] = text.charCodeAt(i)
		}
		return bytes
	}
	const concat = (...parts: Uint8Array[]) => {
		const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
		parts.reduce((offset, part) => (bytes.set(part, offset), offset + part.length), 0)
		return bytes
	}
	const records = (size: number, rows: number[][], layout: string) =>
		concat(
			...rows.map((row) => {
				const bytes = new Uint8Array(size)
				const view = new DataView(bytes.buffer)
				let offset = 0
				row.forEach((value, i) => {
					const kind = layout[i]
					if (kind === "s") {
						bytes.set(ascii(String(value), 20), offset)
						offset += 20
					} else if (kind === "I") {
						view.setUint32(offset, value, true)
						offset += 4
					} else if (kind === "H") {
						view.setUint16(offset, value, true)
						offset += 2
					} else if (kind === "h") {
						view.setInt16(offset, value, true)
						offset += 2
					} else {
						view.setInt8(offset, value)
						offset += 1
					}
				})
				return bytes
			})
		)
	const chunk = (id: string, body: Uint8Array) => {
		const header = new DataView(new ArrayBuffer(8))
		ascii(id).forEach((code, i) => header.setUint8(i, code))
		header.setUint32(4, body.length, true)
		return concat(new Uint8Array(header.buffer), body, new Uint8Array(body.length & 1))
	}
	const list = (type: string, ...chunks: Uint8Array[]) =>
		chunk("LIST", concat(ascii(type), ...chunks))
	const names = (text: string) => text as unknown as number
	const pcm = new Int16Array(240)
	pcm.fill(1000, 0, 100)
	pcm.fill(-2000, 120, 220)
	const range = (low: number, high: number) => low | (high << 8)
	const generators = [
		[43, range(0, 59)],
		[58, 60],
		[54, 1],
		[53, 0],
		[43, range(60, 127)],
		[48, 100],
		[37, 1000],
		[53, 1],
		[0, 0]
	]
	const file = list(
		"sfbk",
		list(
			"INFO",
			chunk("ifil", records(4, [[2, 1]], "HH")),
			chunk("INAM", ascii("Test Bank\0"))
		),
		list("sdta", chunk("smpl", new Uint8Array(pcm.buffer))),
		list(
			"pdta",
			chunk(
				"phdr",
				records(
					38,
					[
						[names("Test"), 0, 0, 0, 0, 0, 0],
						[names("EOP"), 0, 0, 1, 0, 0, 0]
					],
					"sHHHIII"
				)
			),
			chunk(
				"pbag",
				records(
					4,
					[
						[0, 0],
						[1, 0]
					],
					"HH"
				)
			),
			chunk("pmod", new Uint8Array(10)),
			chunk(
				"pgen",
				records(
					4,
					[
						[41, 0],
						[0, 0]
					],
					"Hh"
				)
			),
			chunk(
				"inst",
				records(
					22,
					[
						[names("Inst"), 0],
						[names("EOI"), 2]
					],
					"sH"
				)
			),
			chunk(
				"ibag",
				records(
					4,
					[
						[0, 0],
						[4, 0],
						[8, 0]
					],
					"HH"
				)
			),
			chunk("imod", new Uint8Array(10)),
			chunk("igen", records(4, generators, "Hh")),
			chunk(
				"shdr",
				records(
					46,
					[
						[names("Low"), 0, 100, 10, 90, 22050, 48, 0, 0, 1],
						[names("High"), 120, 220, 120, 120, 44100, 72, 10, 0, 1],
						[names("EOS"), 0, 0, 0, 0, 0, 0, 0, 0, 0]
					],
					"sIIIIIbbHH"
				)
			)
		)
	)
	// The outer LIST becomes the RIFF header
	ascii("RIFF").forEach((code, i) => (file[i] = code))
	return file.buffer
}

it("parses SoundFont banks into zones and copies waves out on demand", async () => {
	const { parseSoundFont, waveData, findPreset, parseNoteName, parseMidiJsPack } =
		await import("../../../packages/audiobus/io/outputs/rompler/soundfont-file")
	const bank = parseSoundFont(testBank())
	expect(bank.name).toBe("Test Bank")
	expect(bank.presets.map(({ name }) => name)).toEqual(["Test"])
	expect(findPreset(bank, 5)).toBe(0)
	const [low, high] = bank.presets[0].regions
	expect(low).toMatchObject({
		wave: 0,
		low: 0,
		high: 59,
		root: 60,
		loop: true,
		loopStart: 10,
		loopEnd: 90,
		gain: 1,
		sustain: 1
	})
	expect(high).toMatchObject({ wave: 1, low: 60, high: 127, loop: false })
	expect(high.root).toBeCloseTo(71.9)
	expect(high.gain).toBeCloseTo(10 ** -0.2)
	expect(high.sustain).toBeCloseTo(0.00001)
	const wave = await waveData(bank, 1, {} as BaseAudioContext)
	expect(wave.sampleRate).toBe(44100)
	expect(Array.from(new Set(wave.data))).toEqual([-2000])
	expect(wave.data).toHaveLength(100)
	expect([
		parseNoteName("Bb3"),
		parseNoteName("A#3"),
		parseNoteName("C-1"),
		parseNoteName("H2")
	]).toEqual([58, 58, 0, undefined])
	const pack = parseMidiJsPack(
		'MIDI.Soundfont.x = {\n"A0": "data:audio/mp3;base64,AAA=",\n"Bb1": "data:audio/mp3;base64,AAA=",\n}'
	)
	expect([...pack.keys()]).toEqual([21, 34])
})

it("plays a soundfont file from a URL, sending zones then waves", async () => {
	const { output, nodes } = fixture({
		soundfont: "https://fonts.test/Test%20Bank.sf2",
		preset: 3
	})
	const file = testBank()
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok: true,
			headers: new Headers({ "content-length": String(file.byteLength) }),
			body: null,
			arrayBuffer: async () => file
		}))
	)
	const gui = await output.createGui()
	await output.connect()
	for (let i = 0; i < 5; i++) {
		await flush()
	}
	const messages = nodes[0].port.postMessage.mock.calls.map(([data]: any[]) => data)
	expect(messages.find(({ type }: any) => type === "regions").regions).toHaveLength(2)
	const waves = messages.filter(({ type }: any) => type === "wave")
	expect(waves.map(({ id }: any) => id).sort()).toEqual([0, 1])
	expect(waves.every(({ data }: any) => data instanceof Int16Array)).toBe(true)
	expect(gui.querySelector(".rompler-soundfont")?.textContent).toBe("Test Bank.sf2 · Test Bank")
	expect([...gui.querySelectorAll(".rompler-item")].map((item) => item.textContent)).toEqual([
		"001Testloops"
	])
	expect(gui.querySelector(".rompler-status")?.textContent).toBe("Test ready")
	expect(output.options.soundfont).toBe("https://fonts.test/Test%20Bank.sf2")
})

it("plays soundfont zones by key range with their pan and envelope", () => {
	const source = readFileSync(
		"../../packages/audiobus/io/outputs/rompler/rompler.worklet.js",
		"utf8"
	)
	const Processor = new Function(
		"AudioWorkletProcessor",
		"sampleRate",
		"currentTime",
		source.replace(/registerProcessor\([^\n]+/, "return RomplerProcessor")
	)(
		class {
			port = {}
		},
		48000,
		0
	)
	const processor = new Processor()
	const send = (data: object) => processor.port.onmessage({ data })
	const render = () => {
		const outputs = [[new Float32Array(128), new Float32Array(128)]]
		processor.process([], outputs)
		return outputs[0]
	}
	const zone = {
		low: 60,
		high: 127,
		velocityLow: 0,
		velocityHigh: 127,
		root: 72,
		scale: 1,
		gain: 1,
		start: 0,
		endOffset: 0,
		loopStart: 0,
		loopEnd: 0,
		loop: false,
		attack: 0.001,
		hold: 0,
		decay: 0.01,
		sustain: 0.00001
	}
	send({ type: "regions", regions: [{ ...zone, wave: 1, pan: 1 }] })
	send({ type: "on", channel: 0, note: 84, velocity: 1 })
	expect(processor.voices).toHaveLength(0)
	send({
		type: "wave",
		id: 1,
		data: new Int16Array(48000).fill(16384),
		sampleRate: 24000,
		scale: 1
	})
	// An octave up at half the context rate plays at the context rate
	expect(processor.voices[0].rate).toBeCloseTo(1)
	const [left, right] = render()
	expect(left.some(Boolean)).toBe(false)
	expect(right[60]).toBeGreaterThan(0.1)
	send({ type: "on", channel: 0, note: 50, velocity: 1 })
	expect(processor.voices).toHaveLength(1)
	for (let i = 0; i < 8; i++) {
		render()
	}
	// The held note decays to silence and frees its voice
	expect(processor.voices).toHaveLength(0)
})
it("offers a collection of soundfonts that open from the panel", async () => {
	const { ROMPLER_SOUNDFONTS } =
		await import("../../../packages/audiobus/io/outputs/rompler/rompler-soundfonts")
	const { output } = fixture()
	const gui = await output.createGui()
	const toggle = gui.querySelector<HTMLButtonElement>(".rompler-current")!
	expect(toggle.textContent).toContain("OpenGM24")
	toggle.click()
	expect(toggle.getAttribute("aria-expanded")).toBe("true")
	const cards = [...gui.querySelectorAll<HTMLButtonElement>(".rompler-card")]
	expect(cards).toHaveLength(ROMPLER_SOUNDFONTS.length)
	expect(cards[0].getAttribute("aria-pressed")).toBe("true")
	// Every entry is a file browsers may fetch, apart from streamed OpenGM24
	expect(ROMPLER_SOUNDFONTS.slice(1).every(({ url }) => /^https:.+\.sf[23]$/.test(url))).toBe(
		true
	)
	const tim = ROMPLER_SOUNDFONTS.findIndex(({ name }) => name === "TimGM6mb")
	expect(cards[tim].textContent).toContain("SF2 · 5.7 MB · GPL-2.0")
	cards[tim].click()
	expect(output.options.soundfont).toBe(ROMPLER_SOUNDFONTS[tim].url)
	expect(toggle.getAttribute("aria-expanded")).toBe("false")
})
it("shares one download between Romplers playing the same soundfont", async () => {
	const url = "https://fonts.test/Shared.sf2"
	const first = fixture({ soundfont: url })
	const second = fixture({ soundfont: url })
	const file = testBank()
	const download = vi.fn(async () => ({
		ok: true,
		headers: new Headers(),
		body: null,
		arrayBuffer: async () => file
	}))
	vi.stubGlobal("fetch", download)
	await Promise.all([first.output.connect(), second.output.connect()])
	for (let i = 0; i < 5; i++) {
		await flush()
	}
	expect(download.mock.calls.filter(([request]: any[]) => request === url)).toHaveLength(1)
	// The later fixture's worklet stub creates both nodes
	expect(second.nodes).toHaveLength(2)
	for (const node of second.nodes) {
		const types = node.port.postMessage.mock.calls.map(([data]: any[]) => data.type)
		expect(types).toContain("regions")
	}
})