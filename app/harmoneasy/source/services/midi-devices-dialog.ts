import { sharedWebMidi } from "audiobus/midi/shared-webmidi"
import {
	loadMidiProfilesForPorts,
	matchMidiDeviceProfile,
	MIDI_DEVICE_PROFILES,
	onMidiDeviceProfilesChanged
} from "audiobus/hardware/midi-devices/device-profiles"
import {
	EVENT_CLOSED,
	EVENT_DEVICE_LIST_CHANGED,
	EVENT_MIDI_CHANNELS_CHANGED,
	EVENT_OPENED,
	EVENT_READY,
	EVENT_TOGGLE,
	EVENT_VISIBILITY_CHANGE
} from "audiobus/events/event-constants"

interface PortStatusEvents {
	addListener(event: typeof EVENT_OPENED | typeof EVENT_CLOSED, callback: () => void): unknown
	removeListener(event: typeof EVENT_OPENED | typeof EVENT_CLOSED, callback: () => void): unknown
}

export interface MidiPortSummary {
	id: string
	type: "input" | "output"
	name: string
	manufacturer: string
	state: "connected" | "disconnected"
	connection: string
}

// Names of the chains using a port, so the list shows where each device is wired.
export type MidiPortConnections = (port: MidiPortSummary) => string[]

const CONNECTION_LABELS: Record<string, string> = {
	open: "open",
	closed: "idle",
	pending: "opening"
}

const summarise = (port: any): MidiPortSummary => ({
	id: String(port.id),
	type: port.type === "output" ? "output" : "input",
	name: port.name || "Unnamed device",
	manufacturer: port.manufacturer || "",
	state: port.state === "disconnected" ? "disconnected" : "connected",
	connection: port.connection ?? ""
})

// List every MIDI device seen this session inside the MIDI dialog: connected
// devices first, then disconnected ones, each with its ports, chains and abilities.
export function createMidiDevicesDialog(
	root: Document = document,
	connections: MidiPortConnections = () => []
): () => void {
	const dialog = root.querySelector<HTMLDialogElement>("#midi-dialog")!
	const status = root.querySelector<HTMLElement>("#midi-devices-status")!
	const list = root.querySelector<HTMLUListElement>("#midi-devices-list")!
	const lifetime = new AbortController()
	// Remembered ports, so a device unplugged this session stays listed as disconnected
	const known = new Map<string, MidiPortSummary>()
	let watching: AbortController | undefined
	let unwatchProfiles: (() => void) | undefined
	let portListeners: (() => void)[] = []
	const visible = () => dialog.open && !dialog.hidden && !root.hidden
	const ports = () => [...sharedWebMidi.inputs, ...sharedWebMidi.outputs]
	const remember = () => {
		const live = new Set<string>()
		for (const port of ports()) {
			const summary = summarise(port)
			known.set(summary.id, summary)
			live.add(summary.id)
		}
		for (const [id, summary] of known) {
			if (!live.has(id)) {
				known.set(id, {
					...summary,
					state: "disconnected",
					connection: ""
				})
			}
		}
	}
	const refreshProfiles = () => {
		if (visible()) {
			void loadMidiProfilesForPorts(ports()).catch((error) =>
				console.debug("MIDI previews unavailable", error)
			)
		}
	}
	const element = <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		className?: string,
		text?: string
	) => {
		const node = root.createElement(tag)
		if (className) {
			node.className = className
		}
		if (text != null) {
			node.textContent = text
		}
		return node
	}
	const fact = (facts: HTMLElement, term: string, value: string | Node[]) => {
		const description = element("dd")
		if (typeof value === "string") {
			description.textContent = value
		} else {
			description.append(...value)
		}
		facts.append(element("dt", undefined, term), description)
	}

	const renderDevice = (ports: MidiPortSummary[]) => {
		const [first] = ports
		const connected = ports.some((port) => port.state === "connected")
		const profileId = ports.map((port) => matchMidiDeviceProfile(port)).find(Boolean)
		const profile = profileId ? MIDI_DEVICE_PROFILES[profileId] : undefined
		const item = element("li", "midi-device")
		item.dataset.state = connected ? "connected" : "disconnected"
		if (profile) {
			item.dataset.midiProfile = profile.id
		}

		const head = element("div", "midi-device-head")
		if (profile?.icon) {
			const image = element("img", "midi-device-icon")
			image.src = profile.icon
			image.alt = ""
			image.loading = "lazy"
			image.decoding = "async"
			head.append(image)
		}
		const title = element("div", "midi-device-title")
		title.append(element("strong", undefined, first.name))
		const maker = profile?.manufacturer || first.manufacturer
		const subtitle = [maker, profile && profile.name !== first.name ? profile.name : ""]
			.filter(Boolean)
			.join(" · ")
		if (subtitle) {
			title.append(element("small", undefined, subtitle))
		}
		head.append(
			title,
			element("span", "midi-device-state", connected ? "Connected" : "Disconnected")
		)
		item.append(head)

		const facts = element("dl", "midi-device-facts")
		fact(
			facts,
			"Ports",
			ports.map((port) => {
				const label = element("span", "midi-device-port")
				const connection =
					port.state === "connected" ? CONNECTION_LABELS[port.connection] : ""
				label.append(
					`${port.type === "input" ? "In" : "Out"}${connection ? ` · ${connection}` : ""}`
				)
				label.title = `Port ID ${port.id}`
				return label
			})
		)
		const inputs = ports.filter((port) => port.type === "input" && port.state === "connected")
		if (inputs.length) {
			const channels = [
				...new Set(inputs.flatMap((port) => sharedWebMidi.observedChannels(port.id)))
			].sort((a, b) => a - b)
			fact(facts, "Channels heard", channels.join(", ") || "None yet")
		}
		const chains = [...new Set(ports.flatMap((port) => connections(port)))]
		fact(facts, "Chains", chains.join(", ") || "Not used by any chain")
		const abilities = [
			ports.some((port) => port.type === "input") ? "Sends MIDI" : "",
			ports.some((port) => port.type === "output") ? "Receives MIDI" : "",
			...(profile?.abilities ?? [])
		].filter(Boolean)
		fact(facts, "Capabilities", abilities.join(" · "))
		item.append(facts)

		const links = [
			["Product", profile?.productUrl],
			["Manufacturer", profile?.manufacturerUrl],
			["MIDI documentation", profile?.documentation[0]?.url]
		].filter((link): link is [string, string] => Boolean(link[1]))
		if (links.length) {
			const nav = element("p", "midi-device-links")
			for (const [label, url] of links) {
				const link = element("a", undefined, label)
				link.href = url
				link.target = "_blank"
				link.rel = "noopener noreferrer"
				nav.append(link)
			}
			item.append(nav)
		}
		return item
	}

	const render = () => {
		if (!visible()) {
			return
		}
		remember()
		const devices = new Map<string, MidiPortSummary[]>()
		for (const port of known.values()) {
			const key = `${port.manufacturer}\u0000${port.name}`
			devices.set(key, [...(devices.get(key) ?? []), port])
		}
		const groups = [...devices.values()]
			.map((group) =>
				group.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id))
			)
			.sort(
				(a, b) =>
					Number(b.some((port) => port.state === "connected")) -
						Number(a.some((port) => port.state === "connected")) ||
					a[0].name.localeCompare(b[0].name)
			)
		const connected = groups.filter((group) =>
			group.some((port) => port.state === "connected")
		).length
		const disconnected = groups.length - connected
		status.textContent = !sharedWebMidi.isReady
			? "MIDI access starts with the session. Start it to list your devices."
			: !groups.length
				? "No MIDI devices found. Check the cable and power; devices appear here as soon as they are plugged in."
				: [`${connected} connected`, disconnected ? `${disconnected} disconnected` : ""]
						.filter(Boolean)
						.join(" · ")
		list.hidden = !groups.length
		list.replaceChildren(...groups.map(renderDevice))
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
	// Recording names is cheap, so ports that come and go while the dialog is
	// closed are still listed once it opens.
	sharedWebMidi.addEventListener(EVENT_DEVICE_LIST_CHANGED, remember, {
		signal: lifetime.signal
	})
	dialog.addEventListener(EVENT_TOGGLE, syncVisibility, {
		signal: lifetime.signal
	})
	root.addEventListener(EVENT_VISIBILITY_CHANGE, syncVisibility, {
		signal: lifetime.signal
	})
	remember()
	return () => {
		stop()
		lifetime.abort()
	}
}
