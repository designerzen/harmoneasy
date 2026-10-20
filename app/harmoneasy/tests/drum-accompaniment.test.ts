// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutputDrumAccompaniment from '../../../packages/audiobus/io/outputs/output-drum-accompaniment.ts'
import { DRUM_GENRES } from '../../../packages/audiobus/io/outputs/drum-accompaniment-settings.ts'
import { DRUM_GROOVES } from '../../../packages/audiobus/timing/drum-patterns.ts'
import { createOutputById } from '../../../packages/audiobus/io/output-factory.ts'
import { DRUM_ACCOMPANIMENT } from '../../../packages/audiobus/io/outputs/output-types.ts'
import { deviceDefinition } from '../../../packages/audiobus/io/device-definition.ts'
import type { PercussionHit } from '../../../packages/audiobus/timing/percussion-types.ts'

const devices: OutputDrumAccompaniment[] = []
function setup() {
	vi.useFakeTimers()
	const clock = { currentTime: 10, state: 'running' }
	const percussion = {
		trigger: vi.fn<(hit: Readonly<PercussionHit>) => void>(),
		allNotesOff: vi.fn(),
	}
	const device = new OutputDrumAccompaniment({
		audioContext: clock as unknown as AudioContext,
		percussionOutput: percussion,
	})
	devices.push(device)
	const tick = (step: number, bpm = 120) => {
		const stepDuration = 60 / bpm / 4
		const triggerAt = 10 + step * stepDuration
		clock.currentTime = triggerAt
		device.onClockTick({ step, bpm, triggerAt, stepDuration })
	}
	return { device, clock, percussion, tick }
}
afterEach(() => {
	for (const device of devices.splice(0)) device.destroy()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

describe('Global-clock drum accompaniment', () => {
	it('plays a constant break without held notes, timers, or note-triggered restarts', () => {
		const { device, percussion, tick } = setup()
		device.noteOn(60, 100)
		device.noteOff(60)
		expect(percussion.trigger).not.toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
		tick(0)
		expect(percussion.trigger.mock.calls.some(([hit]) => hit.part === 'kick')).toBe(true)
		const first = percussion.trigger.mock.calls.length
		device.noteOn(64, 120)
		device.noteOff(64)
		expect(percussion.trigger).toHaveBeenCalledTimes(first)
		for (let step = 1; step < 16; step++) tick(step)
		const original = percussion.trigger.mock.calls.map(([hit]) => ({
			...hit,
			triggerAt: hit.triggerAt - 10,
		}))
		percussion.trigger.mockClear()
		for (let step = 16; step < 32; step++) tick(step)
		const repeated = percussion.trigger.mock.calls.map(([hit]) => ({
			...hit,
			triggerAt: hit.triggerAt - 12,
		}))
		expect(repeated).toEqual(original)
		expect(device.isPlaying).toBe(true)
	})
	it('uses absolute transport positions and tempo changes without duplicate or catch-up hits', () => {
		const { device, percussion, tick } = setup()
		tick(8)
		const expected = DRUM_GROOVES['funky-drummer']
		const hits = percussion.trigger.mock.calls.map(([hit]) => hit)
		expect(hits.find((hit) => hit.part === 'hat')?.velocity).toBeCloseTo(
			(expected.hat[8] / 255) * 0.8 * 0.55,
		)
		const count = hits.length
		tick(8)
		expect(percussion.trigger).toHaveBeenCalledTimes(count)
		percussion.trigger.mockClear()
		tick(32, 90)
		expect(
			percussion.trigger.mock.calls.every(
				([hit]) => hit.triggerAt === 10 + 32 * (60 / 90 / 4),
			),
		).toBe(true)
		device.stopClock()
		expect(device.isPlaying).toBe(false)
		tick(0)
		expect(device.isPlaying).toBe(true)
	})
	it('only adds bounded phrase-ending ghost notes after sustained activity', () => {
		const quiet = setup(),
			busy = setup()
		quiet.device.configure({ activityResponse: 1, fillChance: 1, rapidPercussion: true })
		busy.device.configure({ activityResponse: 1, fillChance: 1, rapidPercussion: true })
		for (let step = 0; step < 16; step++) {
			for (let note = 0; note < 4; note++) {
				busy.device.noteOn(60 + note)
				busy.device.noteOff(60 + note)
			}
			quiet.tick(step)
			busy.tick(step)
		}
		const base = quiet.percussion.trigger.mock.calls.map(([hit]) => hit)
		const expressive = busy.percussion.trigger.mock.calls.map(([hit]) => hit)
		for (const hit of base) expect(expressive).toContainEqual(hit)
		const additions = expressive.filter(
			(hit) => !base.some((original) => JSON.stringify(original) === JSON.stringify(hit)),
		)
		expect(additions.length).toBeGreaterThan(0)
		expect(additions.length).toBeLessThanOrEqual(8)
		expect(additions.every((hit) => hit.triggerAt >= 11.5 && hit.velocity <= 0.2)).toBe(true)
	})
	it('keeps configured tuning independent of the keys being played', () => {
		const { device, percussion, tick } = setup()
		device.configure({ tuningNote: 57 })
		device.noteOn(24)
		tick(0)
		device.noteOn(104)
		tick(1)
		expect(percussion.trigger.mock.calls.every(([hit]) => hit.tuningNote === 57)).toBe(true)
		device.configure({ tuningNote: 200 })
		expect(device.options.tuningNote).toBe(127)
		device.configure({ tuningNote: Number.NaN })
		expect(device.options.tuningNote).toBe(127)
	})
	it('stops on disconnect, prevents duplicate clocks, and destroys cleanly', async () => {
		const { device, percussion, tick } = setup()
		tick(0)
		await device.disconnect()
		const count = percussion.trigger.mock.calls.length
		tick(1)
		expect(percussion.trigger).toHaveBeenCalledTimes(count)
		expect(percussion.allNotesOff).toHaveBeenCalled()
		await device.connect()
		tick(2)
		expect(percussion.trigger.mock.calls.length).toBeGreaterThan(count)
		device.destroy()
		tick(3)
		expect(device.isPlaying).toBe(false)
		expect(vi.getTimerCount()).toBe(0)
	})
	it('exposes genre and tuning controls without a private tempo or preview', async () => {
		const { device } = setup()
		const gui = await device.createGui()
		document.body.append(gui)
		expect(gui.querySelector('[name="bpm"]')).toBeNull()
		expect(gui.textContent).not.toContain('Preview')
		expect(gui.textContent).toContain('global transport')
		const genre = gui.querySelector<HTMLSelectElement>('[name="genre"]')!
		genre.value = 'latin'
		genre.dispatchEvent(new Event('change'))
		const groove = gui.querySelector<HTMLSelectElement>('[name="groove"]')!
		groove.value = 'samba'
		groove.dispatchEvent(new Event('change'))
		const tuning = gui.querySelector<HTMLSelectElement>('[name="tuningNote"]')!
		expect(tuning.options).toHaveLength(128)
		tuning.value = '69'
		tuning.dispatchEvent(new Event('change'))
		expect(device.options).toMatchObject({ genre: 'latin', groove: 'samba', tuningNote: 69 })
		const request = vi.spyOn(device, 'requestFill')
		gui.querySelector('button')!.click()
		expect(request).toHaveBeenCalledOnce()
		await device.destroyGui()
		expect(document.body.contains(gui)).toBe(false)
	})
	it('preserves compressor controls and saved genre, tuning, and activity response', async () => {
		const { device, clock, percussion } = setup()
		const gui = await device.createGui()
		const threshold = gui.querySelector<HTMLInputElement>('[name="compressorThreshold"]')!
		threshold.value = '-27'
		threshold.dispatchEvent(new Event('input'))
		expect(threshold.parentElement!.querySelector('output')!.textContent).toBe('-27 dB')
		const enabled = gui.querySelector<HTMLInputElement>('[name="compressorEnabled"]')!
		enabled.checked = false
		enabled.dispatchEvent(new Event('change'))
		expect(threshold.disabled).toBe(true)
		vi.stubGlobal('AudioContext', class {})
		const restored = (await createOutputById(DRUM_ACCOMPANIMENT, {
			audioContext: clock,
			percussionOutput: percussion,
			...device.options,
			tuningNote: 48,
			activityResponse: 0.4,
		})) as OutputDrumAccompaniment
		devices.push(restored)
		expect(deviceDefinition(restored)).toMatchObject({
			factory: 'output',
			options: {
				tuningNote: 48,
				activityResponse: 0.4,
				compressorThreshold: -27,
				compressorEnabled: false,
			},
		})
		expect(restored.options).not.toHaveProperty('bpm')
		expect(new Set(Object.values(DRUM_GENRES).flatMap((genre) => [...genre.grooves]))).toEqual(
			new Set(Object.keys(DRUM_GROOVES)),
		)
	})
})