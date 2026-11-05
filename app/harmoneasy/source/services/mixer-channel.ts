import { EVENT_CONNECTION_CHANGED } from "audiobus/event-constants"

/** A separate mix gain preserves the engine's own gain, envelopes and calibration. */
export function createMixerChannels(destinations: AudioNode[]) {
	const channels = new Map<
		object,
		{ source: AudioNode; gain: GainNode; routes: AudioNode[]; events: AbortController }
	>()
	const remove = (key: object, restore: boolean) => {
		const channel = channels.get(key)
		if (!channel) {
			return
		}
		channel.events.abort()
		try {
			channel.source.disconnect(channel.gain)
		} catch {
			/* Output already disposed. */
		}
		channel.gain.disconnect()
		if (restore && channel.source.context.state !== "closed") {
			for (const route of channel.routes) {
				channel.source.connect(route)
			}
		}
		channels.delete(key)
	}
	return {
		get(key: object, source?: AudioNode, refresh = false): GainNode | undefined {
			const previous = channels.get(key)
			if (previous?.source === source) {
				if (previous && refresh) {
					for (const route of previous.routes) {
						try {
							previous.source.disconnect(route)
						} catch {
							continue
						}
						previous.source.connect(previous.gain)
					}
				}
				return previous?.gain
			}
			const level = previous?.gain.gain.value ?? 1
			remove(key, false)
			if (!source || source.context.state === "closed") {
				return
			}
			const routes: AudioNode[] = []
			// Replace only known audible routes, leaving other taps and plugin links intact.
			for (const route of new Set([...destinations, source.context.destination])) {
				if (!route || route.context !== source.context) {
					continue
				}
				try {
					source.disconnect(route)
					routes.push(route)
				} catch {
					/* Not this Output's route. */
				}
			}
			if (!routes.length) {
				return
			}
			const gain = source.context.createGain()
			gain.gain.value = level
			source.connect(gain)
			for (const route of routes) {
				gain.connect(route)
			}
			const events = new AbortController()
			channels.set(key, { source, gain, routes, events })
			const target = key as Partial<EventTarget> & { output?: AudioNode }
			target.addEventListener?.(
				EVENT_CONNECTION_CHANGED,
				() => {
					this.get(key, target.output, true)
				},
				{ signal: events.signal }
			)
			return gain
		},
		prune(active: Set<object>) {
			for (const key of channels.keys()) {
				if (!active.has(key)) {
					remove(key, false)
				}
			}
		},
		destroy() {
			for (const key of channels.keys()) {
				remove(key, true)
			}
		}
	}
}