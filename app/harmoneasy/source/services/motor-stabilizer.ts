import type { IAudioCommand } from "audiobus/commands/audio-command-interface"
import { NOTE_OFF, NOTE_ON } from "audiobus/commands/commands"
import InputAudioEvent from "audiobus/io/events/input-audio-event"
import type IOChainManager from "audiobus/io/IO-chain-manager"

export interface MotorStabilizerSettings {
	enabled: boolean
	/** Minimum ms between accepted NOTE_ON triggers for the same note (retrigger lockout). */
	debounceMs: number
	/** Minimum continuous hold ms required before NOTE_ON sounds (tremor rejection). */
	holdThresholdMs: number
	/** Minimum sustain duration ms before NOTE_OFF is emitted (release smoothing). */
	minDurationMs: number
}

export interface MotorStabilizerStats {
	suppressedBounces: number
	filteredTremors: number
	extendedReleases: number
}

interface PendingNote {
	timer: ReturnType<typeof setTimeout>
	chainId: string
	command: IAudioCommand
}

/**
 * Filters noisy or tremulous note triggers with configurable debounce lockout,
 * hold-threshold tremor smoothing, and minimum note duration enforcement.
 */
export class MotorStabilizer {
	private readonly bypass = new WeakSet<IAudioCommand>()
	private readonly lastAcceptedOnMs = new Map<string, number>()
	private readonly soundingSinceMs = new Map<string, number>()
	private readonly pendingOn = new Map<string, PendingNote>()
	private readonly pendingOff = new Map<string, PendingNote>()
	private stats: MotorStabilizerStats = {
		suppressedBounces: 0,
		filteredTremors: 0,
		extendedReleases: 0
	}

	constructor(
		private readonly getSettings: () => MotorStabilizerSettings,
		private readonly reemit: (chainId: string, command: IAudioCommand) => void,
		private readonly nowMs: () => number = () => Date.now()
	) {}

	getStats(): MotorStabilizerStats {
		return { ...this.stats }
	}

	/**
	 * Process an incoming command.
	 * Returns true when the command was suppressed or deferred by stabilization,
	 * or false when it should continue through the chain immediately.
	 */
	process(chainId: string, command: IAudioCommand): boolean {
		if (this.bypass.has(command)) {
			this.bypass.delete(command)
			return false
		}
		if (
			(command.type !== NOTE_ON && command.type !== NOTE_OFF) ||
			typeof command.number !== "number" ||
			!Number.isFinite(command.number)
		) {
			return false
		}

		const key = `${chainId}:${command.channel ?? 1}:${command.number}`
		const settings = this.getSettings()
		const active =
			settings.enabled &&
			(settings.debounceMs > 0 ||
				settings.holdThresholdMs > 0 ||
				settings.minDurationMs > 0)

		if (!active) {
			if (command.type === NOTE_OFF) {
				this.cancelPendingOn(key)
				this.cancelPendingOff(key)
				this.soundingSinceMs.delete(key)
			}
			return false
		}

		if (command.type === NOTE_ON) {
			const now = this.nowMs()

			// If a deferred release is pending on this same note, cancel it and keep sustaining.
			if (this.pendingOff.has(key)) {
				this.cancelPendingOff(key)
				this.stats.suppressedBounces++
				return true
			}

			// Duplicate press while waiting for hold threshold.
			if (this.pendingOn.has(key)) {
				this.stats.suppressedBounces++
				return true
			}

			// Accidental retrigger lockout window.
			if (settings.debounceMs > 0) {
				const last = this.lastAcceptedOnMs.get(key)
				if (last !== undefined && now - last < settings.debounceMs) {
					this.stats.suppressedBounces++
					return true
				}
			}

			// Hold-threshold tremor filter: require continuous hold before sounding.
			if (settings.holdThresholdMs > 0) {
				const timer = setTimeout(() => {
					this.pendingOn.delete(key)
					const firedAt = this.nowMs()
					this.soundingSinceMs.set(key, firedAt)
					this.lastAcceptedOnMs.set(key, firedAt)
					this.bypass.add(command)
					this.reemit(chainId, command)
				}, settings.holdThresholdMs)
				this.pendingOn.set(key, { timer, chainId, command })
				return true
			}

			this.soundingSinceMs.set(key, now)
			this.lastAcceptedOnMs.set(key, now)
			return false
		}

		// NOTE_OFF handling
		if (this.pendingOn.has(key)) {
			// Released before hold threshold elapsed -> discard spurious tremor tap.
			this.cancelPendingOn(key)
			this.stats.filteredTremors++
			return true
		}

		if (this.pendingOff.has(key)) {
			return true
		}

		if (settings.minDurationMs > 0 && this.soundingSinceMs.has(key)) {
			const elapsed = this.nowMs() - this.soundingSinceMs.get(key)!
			const remaining = settings.minDurationMs - elapsed
			if (remaining > 0) {
				this.stats.extendedReleases++
				const timer = setTimeout(() => {
					this.pendingOff.delete(key)
					this.soundingSinceMs.delete(key)
					this.bypass.add(command)
					this.reemit(chainId, command)
				}, remaining)
				this.pendingOff.set(key, { timer, chainId, command })
				return true
			}
		}

		this.soundingSinceMs.delete(key)
		return false
	}

	/** Cancel pending note-ons and flush any deferred note-offs so no notes remain stuck. */
	reset(): void {
		for (const pending of this.pendingOn.values()) {
			clearTimeout(pending.timer)
		}
		this.pendingOn.clear()

		const toFlush = [...this.pendingOff.values()]
		this.pendingOff.clear()
		this.soundingSinceMs.clear()
		this.lastAcceptedOnMs.clear()

		for (const pending of toFlush) {
			clearTimeout(pending.timer)
			this.bypass.add(pending.command)
			this.reemit(pending.chainId, pending.command)
		}
	}

	destroy(): void {
		this.reset()
	}

	private cancelPendingOn(key: string): void {
		const pending = this.pendingOn.get(key)
		if (pending) {
			clearTimeout(pending.timer)
			this.pendingOn.delete(key)
		}
	}

	private cancelPendingOff(key: string): void {
		const pending = this.pendingOff.get(key)
		if (pending) {
			clearTimeout(pending.timer)
			this.pendingOff.delete(key)
		}
	}
}

/**
 * Install motor stabilization onto an IOChainManager via `sessionInputHandler`,
 * preserving any previously attached handler.
 */
export function installMotorStabilizer(
	manager: IOChainManager,
	getSettings: () => MotorStabilizerSettings,
	nowMs?: () => number
) {
	const previous = manager.sessionInputHandler
	const stabilizer = new MotorStabilizer(
		getSettings,
		(chainId, command) => {
			const chain = manager.getChain(chainId)
			if (chain?.isActive) {
				chain.onInputEvent(new InputAudioEvent(command))
			}
		},
		nowMs
	)

	const handler: NonNullable<IOChainManager["sessionInputHandler"]> = (chainId, command) => {
		if (stabilizer.process(chainId, command)) {
			return true
		}
		return previous?.(chainId, command) ?? false
	}

	manager.sessionInputHandler = handler

	return {
		stabilizer,
		destroy() {
			stabilizer.destroy()
			if (manager.sessionInputHandler === handler) {
				manager.sessionInputHandler = previous
			}
		}
	}
}
