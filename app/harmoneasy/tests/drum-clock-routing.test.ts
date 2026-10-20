import { afterEach, expect, it, vi } from 'vitest'
import IOChain from '../../../packages/audiobus/io/IO-chain.ts'
import IOChainManager from '../../../packages/audiobus/io/IO-chain-manager.ts'
import type { AudioClockTick } from '../../../packages/audiobus/timing/audio-clock-tick.ts'

const managers: IOChainManager[] = []
function setup() {
	const timer = {
		now: 0,
		BPM: 120,
		position: 0,
		isRunning: true,
		stop: vi.fn(async () => {}),
		start: vi.fn(async () => {}),
		resetTimer: vi.fn(),
	}
	const output = {
		uuid: 'clock-output',
		name: 'Clock output',
		description: '',
		isConnected: true,
		isHidden: false,
		noteOn: vi.fn(),
		noteOff: vi.fn(),
		allNotesOff: vi.fn(),
		onClockTick: vi.fn(),
		stopClock: vi.fn(),
	}
	const manager = new IOChainManager({
		timer: timer as never,
		outputMixer: {} as GainNode,
		externalDevices: { output },
	})
	const chain = new IOChain(timer as never)
	chain.setTransformers([])
	chain.addOutput(output)
	const id = manager.addChain(chain)
	managers.push(manager)
	const tick: AudioClockTick = { step: 128, triggerAt: 10, bpm: 120, stepDuration: 0.125 }
	return { manager, chain, output, id, tick }
}
afterEach(() => {
	for (const manager of managers.splice(0)) manager.destroy()
})

it('routes the global clock once to an output shared by multiple chains', () => {
	const { manager, output, id, tick } = setup()
	manager.cloneChain(id)
	manager.updateClock(tick)
	expect(output.onClockTick).toHaveBeenCalledExactlyOnceWith(tick)
	manager.updateClock({ ...tick, step: 129, bpm: 90, stepDuration: 1 / 6 })
	expect(output.onClockTick).toHaveBeenCalledTimes(2)
	expect(output.onClockTick).toHaveBeenLastCalledWith(
		expect.objectContaining({ bpm: 90, step: 129 }),
	)
})

it('keeps a shared break running until every owning chain disables it', () => {
	const { manager, chain, output, id, tick } = setup()
	const clone = manager.getChain(manager.cloneChain(id))!
	manager.updateClock(tick)
	chain.outputManager.setEnabled(output, false)
	expect(output.stopClock).not.toHaveBeenCalled()
	clone.outputManager.setEnabled(output, false)
	expect(output.stopClock).toHaveBeenCalledTimes(1)
	manager.updateClock({ ...tick, step: 129 })
	expect(output.onClockTick).toHaveBeenCalledTimes(1)
	clone.outputManager.setEnabled(output, true)
	manager.updateClock({ ...tick, step: 130 })
	expect(output.onClockTick).toHaveBeenCalledTimes(2)
})

it('stops accompaniment on global stop and excludes inactive chains', async () => {
	const { manager, chain, output, tick } = setup()
	manager.updateClock(tick)
	chain.setActive(false)
	expect(output.stopClock).toHaveBeenCalledTimes(1)
	manager.updateClock({ ...tick, step: 129 })
	expect(output.onClockTick).toHaveBeenCalledTimes(1)
	chain.setActive(true)
	manager.updateClock({ ...tick, step: 130 })
	await manager.transport('stop')
	expect(output.stopClock).toHaveBeenCalledTimes(2)
	manager.updateClock({ ...tick, step: 131 })
	expect(output.onClockTick).toHaveBeenCalledTimes(2)
})