// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutputDrumAccompaniment from '../../../packages/audiobus/io/outputs/output-drum-accompaniment.ts'
import OutputManager from '../../../packages/audiobus/io/output-manager.ts'
import { DRUM_GENRES } from '../../../packages/audiobus/io/outputs/drum-accompaniment-settings.ts'
import { DRUM_GROOVES } from '../../../packages/audiobus/timing/drum-patterns.ts'
import { DrumArranger } from '../../../packages/audiobus/timing/drum-arranger.ts'
import { createOutputById, OUTPUT_FACTORIES } from '../../../packages/audiobus/io/output-factory.ts'
import { DRUM_ACCOMPANIMENT } from '../../../packages/audiobus/io/outputs/output-types.ts'
import { deviceDefinition } from '../../../packages/audiobus/io/device-definition.ts'
import { NOTE_ON, NOTE_OFF } from '../../../packages/audiobus/commands.ts'
import type { IAudioCommand } from '../../../packages/audiobus/audio-command-interface.ts'
import type { PercussionHit } from '../../../packages/audiobus/timing/percussion-types.ts'

const devices: OutputDrumAccompaniment[] = []
function setup() {
	vi.useFakeTimers()
	const clock = { currentTime: 10, state: 'running', resume: vi.fn(async () => {}) }
	const percussion = {
		trigger: vi.fn<(hit: Readonly<PercussionHit>) => void>(),
		allNotesOff: vi.fn(),
	}
	const device = new OutputDrumAccompaniment({
		audioContext: clock as unknown as AudioContext,
		percussionOutput: percussion,
	})
	devices.push(device)
	const advance = (seconds: number) => {
		for (let elapsed = 0; elapsed < seconds; elapsed += 0.025) {
			clock.currentTime += 0.025
			vi.advanceTimersByTime(25)
		}
	}
	return { device, clock, percussion, advance }
}

afterEach(() => {
	for (const device of devices.splice(0)) device.destroy()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

describe('Drum accompaniment output', () => {
	it('schedules one groove for a chord and stops after the last note releases', async () => {
		const { device, percussion, advance } = setup()
		await device.noteOn(60, 100)
		const first = percussion.trigger.mock.calls.length
		await device.noteOn(64, 90)
		expect(percussion.trigger).toHaveBeenCalledTimes(first)
		expect(percussion.trigger.mock.calls.some(([hit]) => hit.part === 'kick')).toBe(true)
		advance(0.5)
		expect(percussion.trigger.mock.calls.length).toBeGreaterThan(first)
		device.noteOff(60)
		expect(device.isPlaying).toBe(true)
		device.noteOff(64)
		expect(device.isPlaying).toBe(false)
		const stopped = percussion.trigger.mock.calls.length
		advance(1)
		expect(percussion.trigger).toHaveBeenCalledTimes(stopped)
		expect(vi.getTimerCount()).toBe(0)
	})

	it('preserves held note ownership while changing controls, including shared chains', async () => {
		const { device, percussion } = setup()
		const first = new OutputManager(),
			second = new OutputManager()
		first.add(device)
		second.add(device)
		const command = { type: NOTE_ON, number: 60, channel: 2, velocity: 100 } as IAudioCommand
		await first.triggerAudioCommandOnDevice(command, device)
		await second.triggerAudioCommandOnDevice(command, device)
		device.configure({ genre: 'latin', groove: 'samba', swing: 0.4 })
		first.setEnabled(device, false)
		await OutputManager.settled(device)
		expect(device.isPlaying).toBe(true)
		await second.triggerAudioCommandOnDevice({ ...command, type: NOTE_OFF }, device)
		expect(device.isPlaying).toBe(false)
		expect(percussion.allNotesOff).toHaveBeenCalled()
		first.destroy()
		second.destroy()
	})

	it('cancels pending voices when stopped, disconnected, or destroyed', async () => {
		const { device, percussion, advance } = setup()
		await device.noteOn(60)
		device.allNotesOff()
		const count = percussion.trigger.mock.calls.length
		advance(0.5)
		expect(percussion.trigger).toHaveBeenCalledTimes(count)
		await device.noteOn(60)
		await device.disconnect()
		expect(device.isConnected).toBe(false)
		await device.noteOn(64)
		expect(device.isPlaying).toBe(false)
		await device.connect()
		await device.noteOn(60)
		device.destroy()
		expect(vi.getTimerCount()).toBe(0)
	})

	it('exposes working genre, groove, character, preview, and fill controls', async () => {
		const { device } = setup()
		const gui = await device.createGui()
		document.body.append(gui)
		expect(await device.createGui()).toBe(gui)
		const genre = gui.querySelector<HTMLSelectElement>('[name="genre"]')!
		genre.value = 'latin'
		genre.dispatchEvent(new Event('change'))
		const groove = gui.querySelector<HTMLSelectElement>('[name="groove"]')!
		expect([...groove.options].map((option) => option.value)).toContain('samba')
		groove.value = 'samba'
		groove.dispatchEvent(new Event('change'))
		const energy = gui.querySelector<HTMLInputElement>('[name="energy"]')!
		energy.value = '0.8'
		energy.dispatchEvent(new Event('input'))
		const rapid = gui.querySelector<HTMLInputElement>('[name="rapidPercussion"]')!
		rapid.checked = true
		rapid.dispatchEvent(new Event('change'))
		expect(device.options).toMatchObject({
			genre: 'latin',
			groove: 'samba',
			energy: 0.8,
			rapidPercussion: true,
		})
		const fill = vi.spyOn(device, 'requestFill')
		const buttons = [...gui.querySelectorAll('button')]
		buttons.find((button) => button.textContent === 'Request fill')!.click()
		expect(fill).toHaveBeenCalledOnce()
		const preview = buttons.find((button) => button.textContent === 'Preview groove')!
		preview.click()
		await Promise.resolve()
		await Promise.resolve()
		expect(device.isPreviewing).toBe(true)
		expect(preview.getAttribute('aria-pressed')).toBe('true')
		preview.click()
		await Promise.resolve()
		await Promise.resolve()
		expect(device.isPlaying).toBe(false)
		await device.destroyGui()
		expect(document.body.contains(gui)).toBe(false)
	})

	it('registers the output and persists edited settings', async () => {
		const { clock, percussion } = setup()
		vi.stubGlobal('AudioContext', class {})
		expect(
			OUTPUT_FACTORIES.find((factory) => factory.id === DRUM_ACCOMPANIMENT)?.isAvailable(),
		).toBe(true)
		const device = (await createOutputById(DRUM_ACCOMPANIMENT, {
			audioContext: clock,
			percussionOutput: percussion,
		})) as OutputDrumAccompaniment
		devices.push(device)
		device.configure({
			genre: 'jazz',
			bpm: 95,
			volume: 0.2,
			compressorThreshold: -30,
			compressorEnabled: false,
		})
		expect(deviceDefinition(device)).toMatchObject({
			factory: 'output',
			type: DRUM_ACCOMPANIMENT,
			options: {
				genre: 'jazz',
				groove: 'jazz-swing',
				bpm: 95,
				volume: 0.2,
				compressorThreshold: -30,
				compressorEnabled: false,
			},
		})
		for (const genre of Object.values(DRUM_GENRES)) {
			for (const groove of genre.grooves) expect(DRUM_GROOVES[groove], groove).toBeDefined()
		}
		expect(new Set(Object.values(DRUM_GENRES).flatMap((genre) => [...genre.grooves]))).toEqual(
			new Set(Object.keys(DRUM_GROOVES)),
		)
	})

	it('edits compressor controls, displays audio units, and preserves settings during bypass', async () => {
		const { device } = setup()
		const gui = await device.createGui()
		const threshold = gui.querySelector<HTMLInputElement>('[name="compressorThreshold"]')!
		const attack = gui.querySelector<HTMLInputElement>('[name="compressorAttack"]')!
		const enabled = gui.querySelector<HTMLInputElement>('[name="compressorEnabled"]')!
		expect(threshold.valueAsNumber).toBe(-18)
		expect(enabled.checked).toBe(true)
		threshold.value = '-27'
		threshold.dispatchEvent(new Event('input'))
		attack.value = '0.025'
		attack.dispatchEvent(new Event('input'))
		expect(threshold.parentElement!.querySelector('output')!.textContent).toBe('-27 dB')
		expect(attack.parentElement!.querySelector('output')!.textContent).toBe('25 ms')
		enabled.checked = false
		enabled.dispatchEvent(new Event('change'))
		expect(threshold.disabled).toBe(true)
		expect(attack.disabled).toBe(true)
		expect(device.options).toMatchObject({
			compressorEnabled: false,
			compressorThreshold: -27,
			compressorAttack: 0.025,
		})
		enabled.checked = true
		enabled.dispatchEvent(new Event('change'))
		expect(threshold.disabled).toBe(false)
		expect(threshold.valueAsNumber).toBe(-27)
		device.configure({
			compressorRatio: 99,
			compressorKnee: -1,
			compressorRelease: -4,
			compressorMakeupGain: Number.NaN,
		})
		expect(device.options).toMatchObject({
			compressorRatio: 20,
			compressorKnee: 0,
			compressorRelease: 0.001,
			compressorMakeupGain: 0,
		})
	})

	it('keeps fills within a sixteenth step without mistaking subdivision for tempo', () => {
		const arranger = new DrumArranger({
			groove: 'garage-triplets',
			bpm: 120,
			rapidPercussion: true,
			stepsPerBar: 16,
		})
		arranger.next({ bpm: 120, triggerAt: 10, stepDuration: 0.125 })
		arranger.next({ bpm: 120, triggerAt: 10.125, stepDuration: 0.125 })
		const parts = arranger.next({ bpm: 120, triggerAt: 10.25, stepDuration: 0.125 })
		expect(arranger.getBPM()).toBe(120)
		expect(parts.events).toHaveLength(2)
		expect(parts.events[1].offset).toBeCloseTo((0.125 * 2) / 3)
	})

	it('applies sparse density, part mutes, and input dynamics', async () => {
		const { device, percussion, advance } = setup()
		device.configure({ density: 0 })
		await device.noteOn(60, 30)
		advance(0.5)
		expect(percussion.trigger).not.toHaveBeenCalled()
		device.configure({
			density: 1,
			muteHat: true,
			muteKick: true,
			muteSnare: true,
			muteClap: true,
			energy: 0,
		})
		percussion.trigger.mockClear()
		advance(0.5)
		expect(
			percussion.trigger.mock.calls.every(
				([hit]) => !['kick', 'snare', 'hat', 'clap'].includes(hit.part),
			),
		).toBe(true)
		expect(device.options.energy).toBe(0)
		expect(device.options.muteHat).toBe(true)
		device.configure({ bpm: Number.NaN, volume: 9 })
		expect(device.options.bpm).toBe(120)
		expect(device.options.volume).toBe(1)
	})

	it('swings offbeat sixteenths and follows input velocity when enabled', async () => {
		const { device, percussion, advance } = setup()
		device.configure({ swing: 0.8, energy: 1 })
		await device.noteOn(60, 30)
		const loudKick = percussion.trigger.mock.calls.find(([hit]) => hit.part === 'kick')![0]
			.velocity
		advance(0.125)
		expect(
			percussion.trigger.mock.calls.some(
				([hit]) => Math.abs(hit.triggerAt - 10.185) < 0.00001,
			),
		).toBe(true)
		device.allNotesOff()
		device.configure({ genre: 'latin' })
		device.configure({ genre: 'funk', followDynamics: true })
		percussion.trigger.mockClear()
		await device.noteOn(60, 30)
		const quietKick = percussion.trigger.mock.calls.find(([hit]) => hit.part === 'kick')![0]
			.velocity
		expect(quietKick).toBeLessThan(loudKick * 0.8)
	})
})