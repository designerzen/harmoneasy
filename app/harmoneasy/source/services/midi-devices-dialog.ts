import { sharedWebMidi } from "audiobus/midi/shared-webmidi"
import {
	loadMidiProfilesForPorts,
	matchMidiDeviceProfile,
	MIDI_DEVICE_PROFILES,
	onMidiDeviceProfilesChanged
} from "audiobus/midi/hardware/device-profiles"
import { createMidiDevicePreview } from "audiobus/midi/hardware/device-preview"
import {
	EVENT_CANCEL,
	EVENT_CLICK,
	EVENT_CLOSE,
	EVENT_CLOSED,
	EVENT_DEVICE_LIST_CHANGED,
	EVENT_MIDI_CHANNELS_CHANGED,
	EVENT_OPENED,
	EVENT_READY,
	EVENT_VISIBILITY_CHANGE
} from "audiobus/event-constants"

interface PortStatusEvents {
	addListener(event: typeof EVENT_OPENED | typeof EVENT_CLOSED, callback: () => void): unknown
	removeListener(event: typeof EVENT_OPENED | typeof EVENT_CLOSED, callback: () => void): unknown
}

export function createMidiDevicesDialog(root: Document = document): () => void {
	const button = root.querySelector<HTMLButtonElement>("#btn-midi-devices")!
	const dialog = root.querySelector<HTMLDialogElement>("#midi-devices-dialog")!
	const status = root.querySelector<HTMLElement>("#midi-devices-status")!
	const list = root.querySelector<HTMLTableSectionElement>("#midi-devices-list")!
	const table = dialog.querySelector<HTMLElement>(".midi-devices-table")!
	const lifetime = new AbortController()
	let watching: AbortController | undefined
	let unwatchProfiles: (() => void) | undefined
	let portListeners: (() => void)[] = []
	const visible = () => dialog.open && !dialog.hidden && !root.hidden
	const ports = () => [...sharedWebMidi.inputs, ...sharedWebMidi.outputs]
	const refreshProfiles = () => {
		if (visible()) {
			void loadMidiProfilesForPorts(ports()).catch((error) =>
				console.debug("MIDI previews unavailable", error)
			)
		}
	}

	const render = () => {
		if (!visible()) {
			return
		}
		const devices = ports()
		status.textContent = !sharedWebMidi.isReady
			? "Shared MIDI access is not ready. MIDI permission is requested when starting the session."
			: !devices.length
				? "No MIDI devices connected."
				: `${sharedWebMidi.inputs.length} input ports and ${sharedWebMidi.outputs.length} output ports connected.`
		table.hidden = !devices.length
		const rows = devices.map((port) => {
			const row = root.createElement("tr")
			const channels = port.type === "input" ? sharedWebMidi.observedChannels(port.id) : []
			const connection =
				port.connection === "open"
					? "Open"
					: port.connection === "closed"
						? "Closed"
						: port.connection === "pending"
							? "Pending"
							: ""
			const values = [
				port.name || "Unnamed device",
				port.manufacturer || "Unknown",
				port.type === "input" ? "Input" : "Output",
				[port.state === "disconnected" ? "Disconnected" : "Connected", connection]
					.filter(Boolean)
					.join(" · "),
				port.type === "input" ? channels.join(", ") || "No activity yet" : "—",
				port.id
			]
			for (const value of values) {
				const cell = root.createElement("td")
				cell.textContent = value
				row.append(cell)
			}
			const profileId = matchMidiDeviceProfile(port)
			if (profileId) {
				row.firstElementChild!.append(
					createMidiDevicePreview(MIDI_DEVICE_PROFILES[profileId], root)
				)
			}
			return row
		})
		list.replaceChildren(...rows)
	}
	const unwatchPorts = () => {
		for (const remove of portListeners) {
			remove()
		}
		portListeners = []
	}
	const watchPorts = () => {
		unwatchPorts()
		const watchPort = (port: PortStatusEvents) => {
			port.addListener(EVENT_OPENED, render)
			port.addListener(EVENT_CLOSED, render)
			portListeners.push(() => {
				port.removeListener(EVENT_OPENED, render)
				port.removeListener(EVENT_CLOSED, render)
			})
		}
		for (const port of ports()) {
			watchPort(port)
		}
	}
	const stop = () => {
		watching?.abort()
		watching = undefined
		unwatchProfiles?.()
		unwatchProfiles = undefined
		unwatchPorts()
	}
	const syncVisibility = () => {
		if (!visible()) {
			stop()
			return
		}
		if (!watching) {
			watching = new AbortController()
			const options = { signal: watching.signal }
			const devicesChanged = () => {
				if (visible()) {
					watchPorts()
					render()
					refreshProfiles()
				}
			}
			sharedWebMidi.addEventListener(EVENT_DEVICE_LIST_CHANGED, devicesChanged, options)
			sharedWebMidi.addEventListener(EVENT_READY, devicesChanged, options)
			sharedWebMidi.addEventListener(EVENT_MIDI_CHANNELS_CHANGED, render, options)
			unwatchProfiles = onMidiDeviceProfilesChanged(render)
			watchPorts()
			refreshProfiles()
		}
		render()
	}
	button.addEventListener(
		EVENT_CLICK,
		() => {
			if (!dialog.open) {
				dialog.showModal()
			}
			syncVisibility()
		},
		{ signal: lifetime.signal }
	)
	dialog.addEventListener(EVENT_CLOSE, stop, { signal: lifetime.signal })
	dialog.addEventListener(EVENT_CANCEL, stop, { signal: lifetime.signal })
	root.addEventListener(EVENT_VISIBILITY_CHANGE, syncVisibility, { signal: lifetime.signal })
	button.disabled = false
	return () => {
		stop()
		lifetime.abort()
		button.disabled = true
	}
}