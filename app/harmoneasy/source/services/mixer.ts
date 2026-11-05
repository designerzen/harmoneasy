import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface"
import {
	EVENT_CLICK,
	EVENT_INPUT,
	EVENT_CLOSE,
	EVENT_CANCEL,
	EVENT_VISIBILITY_CHANGE,
	EVENT_CHAINS_UPDATED,
	EVENT_DESTROYED,
	EVENT_PAGE_HIDE,
	EVENT_KEY_DOWN
} from "audiobus/event-constants"
import { createMixerChannels } from "./mixer-channel"
import { createMixerMeter } from "./mixer-meter"
import { element } from "./music-tools-dom"

interface LevelControl {
	read(): number
	write(value: number): void
	maximum: number
}
function outputNode(output: IAudioOutput): AudioNode | undefined {
	const node = output.output as AudioNode | undefined
	return node?.context?.createAnalyser ? node : undefined
}

export function createMixer(manager: IOChainManager, master: GainNode, root: Document = document) {
	const button = root.querySelector<HTMLButtonElement>("#btn-mixer")!
	const lifetime = new AbortController()
	const mixChannels = createMixerChannels([manager.outputMixer, master])
	const dialog = element("dialog")
	dialog.id = "mixer-dialog"
	dialog.className = "mixer-dialog"
	dialog.setAttribute("aria-labelledby", "mixer-title")
	const header = element("header")
	const title = element("h2", "Mixer")
	title.id = "mixer-title"
	const close = element("button", "Close")
	close.type = "button"
	close.setAttribute("aria-label", "Close Mixer")
	header.append(title, close)
	const channels = element("div")
	channels.className = "mixer-channels"
	const hint = element(
		"p",
		"Post-fader RMS levels · peak hold · red indicates clipping · meters run only while visible"
	)
	hint.className = "mixer-hint"
	dialog.append(header, channels, hint)
	root.body.append(dialog)
	const states = new WeakMap<object, { muted: boolean; restore: number }>()
	let strips: { meter: ReturnType<typeof createMixerMeter>; update(): void }[] = []
	let watching: AbortController | undefined
	let rendered: { device: IAudioOutput; name: string; node: AudioNode | undefined }[] = []
	let frame = 0,
		previous = 0
	const visible = () => dialog.open && !dialog.hidden && !root.hidden
	const stop = () => {
		cancelAnimationFrame(frame)
		frame = previous = 0
		watching?.abort()
		watching = undefined
		strips.forEach((strip) => strip.meter.stop())
	}
	const strip = (
		key: object,
		name: string,
		source: () => AudioNode | undefined,
		control?: LevelControl,
		isMaster = false
	) => {
		const channel = element("section")
		channel.className = `mixer-channel${isMaster ? " mixer-master" : ""}`
		channel.setAttribute("aria-label", `${name} channel`)
		const label = element("h3", name)
		label.title = name
		const value = element("output")
		value.className = "mixer-gain-value"
		const body = element("div")
		body.className = "mixer-fader-body"
		const scale = element("div")
		scale.className = "mixer-scale"
		for (const db of [0, -6, -12, -24, -36, -48, -60]) {
			const tick = element("span", String(db))
			tick.style.top = `${-db / 0.6}%`
			scale.append(tick)
		}
		const fader = element("input")
		fader.type = "range"
		fader.min = "-60"
		fader.max = "0"
		fader.step = "0.5"
		fader.className = "mixer-fader"
		fader.setAttribute("aria-label", `${name} volume`)
		fader.setAttribute("aria-orientation", "vertical")
		fader.disabled = !control
		const meterHost = element("div")
		const meter = createMixerMeter(meterHost, source)
		meterHost.setAttribute("aria-label", `${name} output level`)
		body.append(scale, fader, meterHost)
		const mute = element("button", "M")
		mute.type = "button"
		mute.className = "mixer-mute"
		mute.setAttribute("aria-label", `Mute ${name}`)
		mute.disabled = !control
		const state = states.get(key) ?? { muted: false, restore: control?.read() || 1 }
		states.set(key, state)
		const update = () => {
			const gain = control?.read() ?? 0
			const db =
				gain > 0 ? Math.max(-60, 20 * Math.log10(gain / (control?.maximum || 1))) : -60
			if (root.activeElement !== fader) {
				fader.value = String(db)
			}
			value.textContent = !control
				? "Engine level"
				: gain <= 0
					? "−∞ dB"
					: `${db.toFixed(1)} dB`
			fader.setAttribute("aria-valuetext", value.textContent)
			mute.setAttribute("aria-pressed", String(state.muted))
		}
		fader.addEventListener(EVENT_INPUT, () => {
			const db = Number(fader.value)
			state.muted = false
			control?.write(db <= -60 ? 0 : 10 ** (db / 20) * control.maximum)
			update()
		})
		mute.addEventListener(EVENT_CLICK, () => {
			if (!control) {
				return
			}
			if (!state.muted) {
				state.restore = control.read()
			}
			state.muted = !state.muted
			control.write(state.muted ? 0 : state.restore)
			update()
		})
		channel.append(label, value, body, mute)
		channels.append(channel)
		update()
		strips.push({ meter, update })
	}
	const render = () => {
		const outputs = manager.devices
			.filter(
				({ device, direction }) =>
					direction === "output" && (device.hasAudioOutput?.() || outputNode(device))
			)
			.map(({ device }) => ({
				device: device as IAudioOutput,
				name: device.name as string,
				node: outputNode(device)
			}))
		for (const { device, node } of outputs) {
			mixChannels.get(device, node, true)
		}
		if (
			strips.length &&
			outputs.length === rendered.length &&
			outputs.every(
				(item, i) =>
					item.device === rendered[i].device &&
					item.name === rendered[i].name &&
					item.node === rendered[i].node
			)
		) {
			return
		}
		rendered = outputs
		strips.forEach((item) => item.meter.stop())
		strips = []
		channels.replaceChildren()
		for (const { device, name } of outputs) {
			const mixed = () => mixChannels.get(device, outputNode(device))
			const node = mixed()
			strip(
				device,
				name,
				() => mixed() ?? outputNode(device),
				node
					? {
							read: () => mixed()?.gain.value ?? 0,
							write: (value) => {
								const gain = mixed()
								if (gain) {
									gain.gain.setTargetAtTime(value, gain.context.currentTime, 0.01)
								}
							},
							maximum: 1
						}
					: undefined
			)
		}
		const volume = root.querySelector<HTMLInputElement>("#volume")
		strip(
			master,
			"Master",
			() => master,
			{
				read: () => master.gain.value,
				write: (gain) => {
					if (volume) {
						volume.value = String(gain * 100)
						volume.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
					} else {
						master.gain.setTargetAtTime(gain, master.context.currentTime, 0.01)
					}
				},
				maximum: 1
			},
			true
		)
	}
	const animate = (now: number) => {
		if (!visible()) {
			stop()
			return
		}
		if (!previous || now - previous >= 1000 / 30) {
			previous = now
			strips.forEach((item) => {
				item.update()
				item.meter.read(now)
			})
		}
		frame = requestAnimationFrame(animate)
	}
	const sync = () => {
		if (!visible()) {
			stop()
			return
		}
		if (watching) {
			return
		}
		watching = new AbortController()

		root.addEventListener(
			EVENT_KEY_DOWN,
			(event) => {
				if (
					event.key === "Escape" &&
					!event.defaultPrevented &&
					(!root.activeElement?.closest("dialog") || dialog.contains(root.activeElement))
				) {
					event.preventDefault()
					stop()
					dialog.close()
				}
			},
			{ signal: watching.signal }
		)
		render()
		frame = requestAnimationFrame(animate)
	}
	button.addEventListener(
		EVENT_CLICK,
		() => {
			dialog.show()
			sync()
		},
		{ signal: lifetime.signal }
	)
	close.addEventListener(
		EVENT_CLICK,
		() => {
			stop()
			dialog.close()
		},
		{ signal: lifetime.signal }
	)
	dialog.addEventListener(EVENT_CLOSE, stop, { signal: lifetime.signal })
	dialog.addEventListener(EVENT_CANCEL, stop, { signal: lifetime.signal })
	root.addEventListener(EVENT_VISIBILITY_CHANGE, sync, { signal: lifetime.signal })
	root.defaultView?.addEventListener(EVENT_PAGE_HIDE, stop, { signal: lifetime.signal })
	manager.addEventListener(
		EVENT_CHAINS_UPDATED,
		() => {
			mixChannels.prune(new Set(manager.devices.map(({ device }) => device)))
			if (visible()) {
				render()
			}
		},
		{ signal: lifetime.signal }
	)
	const dispose = () => {
		stop()
		lifetime.abort()
		mixChannels.destroy()
		dialog.remove()
		button.disabled = true
	}
	manager.addEventListener(EVENT_DESTROYED, dispose, { signal: lifetime.signal })
	button.disabled = false
	return dispose
}