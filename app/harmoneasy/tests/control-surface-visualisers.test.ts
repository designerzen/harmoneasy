// @vitest-environment happy-dom
import { surfaceNoteSource } from "../source/components/graph/control-surface-notes"
import { EVENT_CONTROL_SURFACE_NOTES } from "audiobus/event-constants"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands"
import type IOChain from "audiobus/io/IO-chain"
import { describe, expect, it, vi } from "vitest"
import { VisualiserFrame, historySource } from "../../../packages/control-surface/src/visualiser"
import { validSurfaces } from "control-surface/model"
import { surfaceAudioSources } from "../source/components/graph/control-surface-audio"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface"

describe("control-surface visualisers", () => {
	it("observes note velocities, channels, releases and panic without generating notes", () => {
		const clock = vi.spyOn(performance, "now").mockReturnValue(1000)
		try {
			const output = new EventTarget(),
				manager = new EventTarget(),
				chain = Object.assign(new EventTarget(), {
					outputs: [output],
					outputManager: manager
				})
			const notes = surfaceNoteSource(chain as unknown as IOChain)
			const send = (type: string, velocity: number, channel = 0) =>
				chain.dispatchEvent(
					new CustomEvent(EVENT_CONTROL_SURFACE_NOTES, {
						detail: [{ type, number: 60, velocity, channel }]
					})
				)
			send(NOTE_ON, 64)
			expect(notes.source.read("notes")!.samples[60]).toBeCloseTo(64 / 127)
			send(NOTE_ON, 100, 1)
			send(NOTE_OFF, 0)
			expect(notes.source.read("notes")!.samples[60]).toBeCloseTo(100 / 127)
			send(NOTE_OFF, 0, 1)
			clock.mockReturnValue(1200)
			expect(notes.source.read("notes")!.samples[60]).toBeGreaterThan(0)
			clock.mockReturnValue(3000)
			expect(notes.source.read("notes")!.samples[60]).toBe(0)
			send(NOTE_ON, 127)
			manager.dispatchEvent(
				new CustomEvent(EVENT_CONTROL_SURFACE_NOTES, { detail: { reset: true } })
			)
			clock.mockReturnValue(5000)
			expect(notes.source.read("notes")!.level).toBe(0)
			notes.destroy()
			send(NOTE_ON, 127)
			expect(notes.source.read("notes")!.level).toBe(0)
		} finally {
			clock.mockRestore()
		}
	})
	it("bounds samples and invalidates geometry only for changed data", () => {
		const frame = new VisualiserFrame()
		frame.update({ samples: [-2, 0, 2, NaN], level: 2 }, "waveform")
		expect(frame.samples).toHaveLength(128)
		expect(frame.samples[0]).toBe(-1)
		expect(frame.samples[64]).toBe(1)
		expect(frame.samples[127]).toBe(0)
		expect(frame.level).toBe(1)
		const revision = frame.revision
		frame.update({ samples: [-2, 0, 2, NaN], level: 2 }, "waveform")
		expect(frame.revision).toBe(revision)
		frame.update(undefined, "waveform")
		expect(frame.available).toBe(false)
		expect(frame.samples.every((value) => value === 0)).toBe(true)
	})
	it("persists backgrounds and widget sources and rejects malformed settings", () => {
		const state = {
			id: "s",
			name: "Surface",
			connections: [],
			widgets: [
				{
					key: "vis",
					widget: "visualiser",
					visualiser: { sourceId: "audio:test", kind: "waveform" }
				}
			],
			background: { sourceId: "audio:test", kind: "spectrum", opacity: 0.22 },
			visualisersPaused: true
		}
		expect(validSurfaces([state])).toBe(true)
		expect(
			validSurfaces([{ ...state, background: { ...state.background, kind: "unknown" } }])
		).toBe(false)
		expect(
			validSurfaces([{ ...state, background: { ...state.background, opacity: NaN } }])
		).toBe(false)
		expect(validSurfaces([{ ...state, visualisersPaused: "yes" }])).toBe(false)
	})
	it("does not overlap asynchronous parameter reads or write to the engine", async () => {
		let finish!: (value: number) => void
		const read = vi.fn(
				() =>
					new Promise<number>((resolve) => {
						finish = resolve
					})
			),
			write = vi.fn()
		const source = historySource({
			key: "parameter",
			sourceLabel: "Synth",
			descriptor: { id: "x", label: "Cutoff", widget: "dial", min: 0, max: 100 },
			read,
			write
		})
		expect(source.read("history")).toBeUndefined()
		source.read("history")
		source.read("level")
		expect(read).toHaveBeenCalledTimes(1)
		finish(75)
		await Promise.resolve()
		await Promise.resolve()
		const frame = source.read("history")!
		expect(frame.level).toBe(0.75)
		expect(frame.samples[127]).toBe(0.75)
		expect(write).not.toHaveBeenCalled()
	})
	it("creates passive audio taps lazily and disconnects only those taps", () => {
		const analyser = {
			fftSize: 1024,
			frequencyBinCount: 512,
			smoothingTimeConstant: 0,
			getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.5),
			getByteFrequencyData: (samples: Uint8Array) => samples.fill(128),
			disconnect: vi.fn()
		}
		const context = { state: "running", createAnalyser: vi.fn(() => analyser) }
		const node = { context, connect: vi.fn(), disconnect: vi.fn() }
		const output = {
			uuid: "test",
			name: "Synth",
			output: node,
			hasAudioOutput: () => true
		} as unknown as IAudioOutput
		const taps = surfaceAudioSources([output])
		expect(context.createAnalyser).not.toHaveBeenCalled()
		const wave = taps.sources[0].read("waveform")!
		expect(wave.level).toBeCloseTo(0.5)
		expect(node.connect).toHaveBeenCalledWith(analyser)
		const spectrum = taps.sources[0].read("spectrum")!
		expect(spectrum.samples[0]).toBeCloseTo(128 / 255)
		expect(context.createAnalyser).toHaveBeenCalledTimes(1)
		taps.destroy()
		expect(node.disconnect).toHaveBeenCalledExactlyOnceWith(analyser)
	})
})