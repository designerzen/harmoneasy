import {
	EVENT_POINTER_CANCEL,
	EVENT_POINTER_LEAVE
} from "audiobus/events/event-constants"
import { deviceDefinition } from "audiobus/io/device-definition"
import { createInputById } from "audiobus/io/input-factory"
import { CAMERA_GESTURES } from "audiobus/io/inputs/input-types"
import type IOChainManager from "audiobus/io/IO-chain-manager"

export const EVENT_POINTER_OVER = "pointerover"
export const EVENT_POINTER_OUT = "pointerout"

export interface DwellControllerOptions {
	grid: HTMLElement
	getDwellMs: () => number
	getCooldownMs?: () => number
	onActivate: (padIndex: number) => void
}

const PROGRESS_TICK_MS = 25
const DEFAULT_COOLDOWN_MS = 500

/**
 * Pointer / eye-tracker dwell activation controller for Focus Stage pads.
 * Renders continuous progress via `--dwell-progress` and enforces a rest cooldown
 * after activation so steady gaze does not machine-gun re-trigger.
 */
export function createDwellController({
	grid,
	getDwellMs,
	getCooldownMs = () => DEFAULT_COOLDOWN_MS,
	onActivate
}: DwellControllerOptions) {
	const abort = new AbortController()
	let activeButton: HTMLButtonElement | null = null
	let dwellTimer: ReturnType<typeof setInterval> | undefined
	let startedAt = 0
	const cooldownTimers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

	const clearDwell = (button?: HTMLButtonElement | null) => {
		if (dwellTimer) {
			clearInterval(dwellTimer)
			dwellTimer = undefined
		}
		const target = button ?? activeButton
		if (target) {
			target.classList.remove("is-dwelling")
			target.style.removeProperty("--dwell-progress")
		}
		if (!button || button === activeButton) {
			activeButton = null
		}
	}

	const clearCooldown = (button: HTMLButtonElement) => {
		const timer = cooldownTimers.get(button)
		if (timer) {
			clearTimeout(timer)
			cooldownTimers.delete(button)
		}
		button.classList.remove("is-cooldown")
	}

	const beginDwell = (button: HTMLButtonElement) => {
		const dwellMs = getDwellMs()
		if (dwellMs <= 0 || cooldownTimers.has(button)) {
			return
		}
		if (activeButton === button && dwellTimer) {
			return
		}
		clearDwell()
		activeButton = button
		startedAt = Date.now()
		button.classList.add("is-dwelling")
		button.style.setProperty("--dwell-progress", "0")

		dwellTimer = setInterval(() => {
			if (!button.isConnected || activeButton !== button) {
				clearDwell(button)
				return
			}
			const elapsed = Date.now() - startedAt
			const progress = Math.min(1, elapsed / dwellMs)
			button.style.setProperty("--dwell-progress", progress.toFixed(3))
			if (progress >= 1) {
				clearDwell(button)
				const padIndex = Number(button.dataset.padIndex)
				if (Number.isFinite(padIndex)) {
					onActivate(padIndex)
				}
				const cooldownMs = getCooldownMs()
				if (cooldownMs > 0) {
					button.classList.add("is-cooldown")
					const timer = setTimeout(() => {
						clearCooldown(button)
					}, cooldownMs)
					cooldownTimers.set(button, timer)
				}
			}
		}, PROGRESS_TICK_MS)
	}

	grid.addEventListener(
		EVENT_POINTER_OVER,
		(event) => {
			const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
				".focus-stage-pad"
			)
			if (target && grid.contains(target)) {
				beginDwell(target)
			}
		},
		{ signal: abort.signal }
	)

	grid.addEventListener(
		EVENT_POINTER_OUT,
		(event) => {
			const pointerEvent = event as PointerEvent
			const leaving = (pointerEvent.target as HTMLElement | null)?.closest<HTMLButtonElement>(
				".focus-stage-pad"
			)
			if (!leaving) {
				return
			}
			const entering = (
				pointerEvent.relatedTarget as HTMLElement | null
			)?.closest<HTMLButtonElement>(".focus-stage-pad")
			if (entering !== leaving) {
				if (leaving === activeButton) {
					clearDwell(leaving)
				}
				clearCooldown(leaving)
			}
		},
		{ signal: abort.signal }
	)

	grid.addEventListener(EVENT_POINTER_LEAVE, () => clearDwell(), { signal: abort.signal })
	grid.addEventListener(EVENT_POINTER_CANCEL, () => clearDwell(), { signal: abort.signal })

	return {
		cancel() {
			clearDwell()
			for (const button of cooldownTimers.keys()) {
				clearCooldown(button)
			}
		},
		destroy() {
			this.cancel()
			abort.abort()
		}
	}
}

/**
 * Attach the existing camera-gestures input to the active chain without duplicating it,
 * enabling hands-free gesture/head-movement play directly from Focus Stage.
 */
export async function attachCameraGestures(
	manager: IOChainManager
): Promise<{ attached: boolean; alreadyActive: boolean; summary: string }> {
	const chain = manager.activeChain ?? manager.chains[0]
	if (!chain) {
		return {
			attached: false,
			alreadyActive: false,
			summary: "No active instrument chain available for Camera Gestures."
		}
	}
	for (const input of chain.inputs) {
		let type: string | undefined
		try {
			type = deviceDefinition(input).type
		} catch {
			type = (input as { type?: string }).type
		}
		if (type === CAMERA_GESTURES) {
			if (typeof input.connect === "function" && !input.isConnected) {
				await input.connect()
			}
			return {
				attached: true,
				alreadyActive: true,
				summary: "Camera Gestures input is already attached to this chain."
			}
		}
	}
	const input = await createInputById(CAMERA_GESTURES, manager.deviceOptions)
	manager.addDevice(chain, input, "input")
	if (typeof input.connect === "function") {
		await input.connect()
	}
	return {
		attached: true,
		alreadyActive: false,
		summary: "Camera Gestures input attached: move hand/head sideways for pitch and pinch to play."
	}
}
