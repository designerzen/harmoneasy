/**
 * audioBus Protocol remote control demo.
 *
 * Embeds (or opens) Harmoneasy and drives it from this page without pairing: notes, drums,
 * controllers, transport, presets, every discovered command and property, and every control the
 * command palette offers. Notes that Harmoneasy's audioBus Protocol output sends back to connected
 * windows are shown, and can be heard, here.
 */
import {
	Peer,
	windowTransport,
	TOPIC_COMMANDS_CHANGED,
	TOPIC_PROPERTIES_CHANGED,
	TOPIC_PROPERTIES_LIST_CHANGED,
	TOPIC_TRANSPORT_CHANGED,
	type CommandDescriptor,
	type Json,
	type Parameter,
	type Params,
	type PropertyDescriptor
} from "audiobus/io/protocol-registry"
import {
	EVENT_BLUR,
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_INPUT,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_LOAD,
	EVENT_LOST_POINTER_CAPTURE,
	EVENT_POINTER_CANCEL,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_UP,
	EVENT_SUBMIT
} from "audiobus/events/event-constants"

interface UiControl {
	id: string
	label: string
	context: string
	kind: "action" | "toggle" | "choice" | "number" | "text"
	value: Json
	options?: string[]
	min?: number
	max?: number
	step?: number
}
interface RemotePreset {
	id: string
	name: string
	category: string
	description: string
	remote?: boolean
}

const BASE = import.meta.env.BASE_URL
const IDENTITY = { name: "Harmoneasy remote control demo", version: "1" }
const RETRY_MS = 1500
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]
/** Presets made for remote control; each has an audioBus Protocol input. */
const REMOTE_PRESETS = [
	{ id: "protocol-step-song", name: "Step through a song", route: "presets/protocol/step-song/" },
	{
		id: "protocol-remote-playground",
		name: "Remote control playground",
		route: "presets/protocol/remote-playground/"
	},
	{
		id: "never-gonna-jam-everything",
		name: "Never Gonna Give You Up — Jam with everything",
		route: "presets/songs/never-gonna-jam-everything/"
	}
]
const DRUMS: [string, number, string][] = [
	["Kick", 36, "z"],
	["Snare", 38, "x"],
	["Clap", 39, "c"],
	["Closed hat", 42, "v"],
	["Open hat", 46, "b"],
	["Low tom", 45, "n"],
	["High tom", 48, "m"],
	["Crash", 49, ","]
]
/** Sixteen steps per pattern: kick, snare and hat notes. */
const BEAT = [
	[36, 42],
	[42],
	[42],
	[42],
	[38, 42],
	[42],
	[36, 42],
	[42],
	[36, 42],
	[42],
	[42],
	[36, 42],
	[38, 42],
	[42],
	[42],
	[46]
]
const CONTROLLERS: [string, number][] = [
	["Modulation", 1],
	["Volume", 7],
	["Pan", 10],
	["Expression", 11],
	["Filter cutoff", 74],
	["Resonance", 71],
	["Reverb", 91],
	["Chorus", 93]
]

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
	document.querySelector(selector) as T
function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	properties: Partial<Record<string, unknown>> = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const node = Object.assign(document.createElement(tag), properties)
	node.append(...children)
	return node
}
const button = (text: string, onClick: () => void, className = "") => {
	const node = element("button", { type: "button", textContent: text, className })
	node.addEventListener(EVENT_CLICK, onClick)
	return node
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const noteName = (note: number) => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Set when Harmoneasy opened this page with `?target=opener`: control that window. */
const opener: Window | null =
	new URLSearchParams(location.search).get("target") === "opener" ? window.opener : null
/** The opener's origin: readable when same-origin, otherwise taken from the referrer. */
function openerOrigin(): string {
	try {
		return opener!.location.origin
	} catch {
		return document.referrer ? new URL(document.referrer).origin : location.origin
	}
}
let target: Window | null = null
let origin = ""
let peer: Peer | undefined
let generation = 0
let commands: CommandDescriptor[] = []

// ── Status and log ───────────────────────────────────────────────────────

function status(text: string, state: "idle" | "waiting" | "connected" = "idle") {
	$("#status").textContent = text
	document.body.dataset.connection = state
}
function log(direction: "→" | "←" | "•", text: string) {
	const list = $("#log")
	const time = new Date().toLocaleTimeString(undefined, { hour12: false })
	list.prepend(
		element(
			"li",
			{ className: `log-${direction === "→" ? "out" : direction === "←" ? "in" : "info"}` },
			`${time} ${direction} ${text}`
		)
	)
	while (list.childElementCount > 200) {
		list.lastElementChild!.remove()
	}
}
const has = (id: string) => commands.some((command) => command.id === id && command.available)

/** Run a command on Harmoneasy; failures are logged without interrupting playing. */
async function call(command: string, args: Params = {}, quiet = false): Promise<Json | undefined> {
	if (!peer) {
		status("Not connected yet — start Harmoneasy and wait for the connection.", "waiting")
		return undefined
	}
	if (!quiet) {
		log("→", `${command} ${Object.keys(args).length ? JSON.stringify(args) : ""}`)
	}
	try {
		return await peer.call(command, args)
	} catch (error) {
		log("•", `${command} failed: ${errorText(error)}`)
		return undefined
	}
}

// ── Opening Harmoneasy ───────────────────────────────────────────────────

function presetUrl(route: string) {
	return new URL(`${BASE}${route}`, location.href).href
}
function open(address: string) {
	const url = new URL(address, location.href)
	if (!["http:", "https:"].includes(url.protocol)) {
		status("Use an HTTP or HTTPS address.")
		return
	}
	origin = url.origin
	$<HTMLInputElement>("#address").value = url.href
	if (opener) {
		// Opened from Harmoneasy: change the window that opened this page instead of embedding one.
		opener.location.href = url.href
		target = opener
		status("Harmoneasy is reloading. Press Start in it; this page reconnects automatically.", "waiting")
		void connect()
		return
	}
	const embed = $<HTMLInputElement>("#embed").checked
	const stage = $("#stage")
	if (embed) {
		let frame = stage.querySelector("iframe")
		if (!frame) {
			frame = element("iframe", {
				title: "Harmoneasy",
				allow: "midi; autoplay; gamepad; fullscreen; microphone"
			})
			// Every load is a fresh application: connect again.
			frame.addEventListener(EVENT_LOAD, () => void connect())
			stage.replaceChildren(frame)
		}
		frame.src = url.href
		target = frame.contentWindow
	} else {
		stage.replaceChildren(
			element("p", {
				className: "hint",
				textContent: "Harmoneasy is open in another window."
			})
		)
		target = window.open(url.href, "harmoneasy")
		if (!target) {
			status("Allow popups for this page, or embed Harmoneasy instead.")
			return
		}
	}
	status(
		"Harmoneasy is loading. Press Start inside it to begin; this page connects automatically.",
		"waiting"
	)
	void connect()
}

// ── Connection ───────────────────────────────────────────────────────────

/** Keeps trying until an audioBus Protocol input in Harmoneasy answers, then reconnects whenever it closes. */
async function connect() {
	const current = ++generation
	const previous = peer
	peer = undefined
	previous?.close()
	enable(false)
	while (current === generation && target) {
		const attempt: Peer = new Peer(windowTransport(target, origin), {
			identity: IDENTITY,
			timeoutMs: 4000,
			onMidi: (bytes) => received(bytes),
			onEvent: (topic, data) => remoteEvent(topic, data),
			onClosed: () => {
				if (peer === attempt) {
					log("•", "Harmoneasy closed the connection; reconnecting")
					void connect()
				}
			}
		})
		try {
			const identity = (await attempt.connect()) as { name?: string; version?: string } | null
			if (current !== generation) {
				attempt.close()
				return
			}
			peer = attempt
			status(
				`Connected to ${identity?.name ?? "Harmoneasy"} ${identity?.version ?? ""}`.trim(),
				"connected"
			)
			log("•", "Connected")
			await connected(attempt)
			return
		} catch (error) {
			attempt.close()
			if (current !== generation) {
				return
			}
			if (target.closed) {
				status("The Harmoneasy window was closed. Open it again to continue.")
				return
			}
			status(
				"Waiting for Harmoneasy: press Start inside it and use a preset with an audioBus Protocol input.",
				"waiting"
			)
			await delay(RETRY_MS)
		}
	}
}

async function connected(connection: Peer) {
	await refreshCommands()
	try {
		const { state } = await connection.subscribeState(TOPIC_TRANSPORT_CHANGED)
		showTransport(state)
		await connection.subscribe(TOPIC_COMMANDS_CHANGED)
		if (connection.supports("properties")) {
			await connection.subscribe(TOPIC_PROPERTIES_CHANGED)
			await connection.subscribe(TOPIC_PROPERTIES_LIST_CHANGED)
		}
	} catch (error) {
		log("•", `Subscribing failed: ${errorText(error)}`)
	}
	enable(true)
	await Promise.all([refreshProperties(), refreshPresets(), refreshInterface()])
}

function enable(on: boolean) {
	for (const section of document.querySelectorAll<HTMLFieldSetElement>("fieldset[data-remote]")) {
		section.disabled = !on
	}
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined
function remoteEvent(topic: string, data: Json) {
	if (topic === TOPIC_TRANSPORT_CHANGED) {
		showTransport(data)
	} else if (topic === TOPIC_PROPERTIES_CHANGED) {
		const { id, value } = (data ?? {}) as { id?: string; value?: Json }
		const output = document.querySelector<HTMLOutputElement>(
			`output[data-property="${CSS.escape(id ?? "")}"]`
		)
		if (output) {
			output.value = JSON.stringify(value)
		}
	} else if (topic === TOPIC_COMMANDS_CHANGED || topic === TOPIC_PROPERTIES_LIST_CHANGED) {
		// Changes arrive in bursts while Harmoneasy rebuilds; refresh once they settle.
		clearTimeout(refreshTimer)
		refreshTimer = setTimeout(() => {
			void refreshCommands()
			void refreshProperties()
		}, 400)
		return
	}
	log("←", `${topic} ${JSON.stringify(data)}`)
}

// ── Received MIDI ────────────────────────────────────────────────────────

let listenContext: AudioContext | undefined
const listening = new Map<string, { oscillator: OscillatorNode; gain: GainNode }>()
function hear(note: number, channel: number, velocity: number) {
	if (!$<HTMLInputElement>("#hear").checked) {
		return
	}
	listenContext ??= new AudioContext()
	const key = `${channel}:${note}`
	silence(key)
	if (!velocity) {
		return
	}
	const oscillator = listenContext.createOscillator()
	const gain = listenContext.createGain()
	oscillator.type = channel === 10 ? "square" : "triangle"
	oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12)
	gain.gain.setValueAtTime(0, listenContext.currentTime)
	gain.gain.linearRampToValueAtTime((velocity / 127) * 0.2, listenContext.currentTime + 0.01)
	oscillator.connect(gain).connect(listenContext.destination)
	oscillator.start()
	listening.set(key, { oscillator, gain })
	if (channel === 10) {
		setTimeout(() => silence(key), 120)
	}
}
function silence(key: string) {
	const voice = listening.get(key)
	if (!voice || !listenContext) {
		return
	}
	listening.delete(key)
	voice.gain.gain.setTargetAtTime(0, listenContext.currentTime, 0.03)
	voice.oscillator.stop(listenContext.currentTime + 0.2)
}

function received(bytes: Uint8Array) {
	const [status, data1 = 0, data2 = 0] = bytes
	const type = status & 0xf0
	const channel = (status & 0x0f) + 1
	let text = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ")
	if (type === 0x90 || type === 0x80) {
		const on = type === 0x90 && data2 > 0
		text = `${on ? "note on" : "note off"} ${noteName(data1)} (${data1}) velocity ${data2} channel ${channel}`
		const key = document.querySelector(`#heard [data-note="${data1}"]`)
		key?.classList.toggle("lit", on)
		if (on) {
			$("#last-note").textContent = `${noteName(data1)} · channel ${channel}`
		}
		hear(data1, channel, on ? data2 : 0)
	} else if (type === 0xb0) {
		text = `controller ${data1} = ${data2} channel ${channel}`
	} else if (type === 0xe0) {
		text = `pitch bend ${((data2 << 7) | data1) - 8192} channel ${channel}`
	} else if (type === 0xc0) {
		text = `program ${data1} channel ${channel}`
	}
	$("#received-count").textContent = String(Number($("#received-count").textContent) + 1)
	log("←", `MIDI ${text}`)
}

// ── Playing ──────────────────────────────────────────────────────────────

const channel = () => Number($<HTMLSelectElement>("#channel").value)
const velocity = () => Number($<HTMLInputElement>("#velocity").value)
const raw = () => $<HTMLInputElement>("#raw-midi").checked

/** Notes go either through the discoverable MIDI commands or as raw WebMidiLink MIDI. */
function noteOn(note: number, on: boolean, noteChannel = channel(), noteVelocity = velocity()) {
	if (!peer) {
		return
	}
	if (raw()) {
		peer.sendMidi([(on ? 0x90 : 0x80) | (noteChannel - 1), note, on ? noteVelocity : 0])
		log("→", `raw MIDI note ${on ? "on" : "off"} ${noteName(note)} channel ${noteChannel}`)
		return
	}
	void call(on ? "midi.noteOn" : "midi.noteOff", {
		note,
		velocity: noteVelocity,
		channel: noteChannel
	})
}
function controlChange(controller: number, value: number, quiet = true) {
	if (raw() && peer) {
		peer.sendMidi([0xb0 | (channel() - 1), controller, value])
		return
	}
	void call("midi.controlChange", { controller, value, channel: channel() }, quiet)
}

/** A pressable element that holds a note while pressed by pointer or keyboard. */
function holdable(node: HTMLElement, press: () => void, release: () => void) {
	let held = false
	const start = (event: Event) => {
		event.preventDefault()
		if (!held) {
			held = true
			node.classList.add("pressed")
			press()
		}
	}
	const stop = () => {
		if (held) {
			held = false
			node.classList.remove("pressed")
			release()
		}
	}
	node.addEventListener(EVENT_POINTER_DOWN, (event) => {
		try {
			node.setPointerCapture(event.pointerId)
		} catch {
			// Not every pointer can be captured.
		}
		start(event)
	})
	for (const type of [
		EVENT_POINTER_UP,
		EVENT_POINTER_CANCEL,
		EVENT_LOST_POINTER_CAPTURE,
		EVENT_BLUR
	]) {
		node.addEventListener(type, stop)
	}
	node.addEventListener(EVENT_KEY_DOWN, (event) => {
		if (!event.repeat && [" ", "Enter"].includes(event.key)) {
			start(event)
		}
	})
	node.addEventListener(EVENT_KEY_UP, (event) => {
		if ([" ", "Enter"].includes(event.key)) {
			stop()
		}
	})
	return { press: start, release: stop }
}

function keyboard(host: HTMLElement, lowest: number, keys: number, playable: boolean) {
	host.replaceChildren()
	for (let note = lowest; note < lowest + keys; note++) {
		const black = NAMES[note % 12].includes("♯")
		const key = element(playable ? "button" : "span", {
			className: black ? "black" : "white",
			textContent: black ? "" : noteName(note)
		})
		key.dataset.note = String(note)
		key.setAttribute("aria-label", noteName(note))
		if (playable) {
			;(key as HTMLButtonElement).type = "button"
			holdable(
				key,
				() => noteOn(note, true),
				() => noteOn(note, false)
			)
		}
		host.append(key)
	}
}

function buildPlaying() {
	for (let index = 1; index <= 16; index++) {
		$("#channel").append(new Option(index === 10 ? "10 (drums)" : String(index), String(index)))
	}
	const octave = $<HTMLInputElement>("#octave")
	const draw = () => keyboard($("#keys"), (Number(octave.value) + 1) * 12, 25, true)
	octave.addEventListener(EVENT_CHANGE, draw)
	draw()
	keyboard($("#heard"), 36, 61, false)

	// One press, one step: the step-through preset plays the next song note for any note on.
	const next = $("#next-note")
	const step = holdable(
		next,
		() => noteOn(60, true),
		() => noteOn(60, false)
	)
	$("#phrase").addEventListener(EVENT_CLICK, async () => {
		for (let index = 0; index < 8 && peer; index++) {
			noteOn(60, true)
			await delay(220)
			noteOn(60, false)
			await delay(60)
		}
	})
	// Space or Enter anywhere on this page (outside fields) also steps.
	window.addEventListener(EVENT_KEY_DOWN, (event) => {
		const field = (event.target as HTMLElement).closest("input,select,textarea,button,summary")
		if (!field && !event.repeat && [" ", "Enter"].includes(event.key)) {
			step.press(event)
		}
		const drum = DRUMS.find(([, , key]) => key === event.key.toLowerCase())
		if (drum && !field && !event.repeat) {
			drumHit(drum[1])
		}
	})
	window.addEventListener(EVENT_KEY_UP, (event) => {
		if ([" ", "Enter"].includes(event.key)) {
			step.release()
		}
	})

	for (const [name, note, key] of DRUMS) {
		const pad = element(
			"button",
			{ type: "button", className: "pad" },
			name,
			element("small", { textContent: `${note} · key ${key.toUpperCase()}` })
		)
		holdable(
			pad,
			() => noteOn(note, true, 10),
			() => noteOn(note, false, 10)
		)
		$("#drums").append(pad)
	}

	const bend = $<HTMLInputElement>("#bend")
	bend.addEventListener(
		EVENT_INPUT,
		() => void call("midi.pitchBend", { value: Number(bend.value), channel: channel() }, true)
	)
	// Pitch bend springs back to the centre when released.
	bend.addEventListener(EVENT_CHANGE, () => {
		bend.value = "0"
		void call("midi.pitchBend", { value: 0, channel: channel() })
	})
	const pressure = $<HTMLInputElement>("#pressure")
	pressure.addEventListener(
		EVENT_INPUT,
		() =>
			void call(
				"midi.channelAftertouch",
				{ pressure: Number(pressure.value), channel: channel() },
				true
			)
	)
	const polyNote = $<HTMLInputElement>("#poly-note")
	const polyPressure = $<HTMLInputElement>("#poly-pressure")
	polyPressure.addEventListener(
		EVENT_INPUT,
		() =>
			void call(
				"midi.polyAftertouch",
				{
					note: Number(polyNote.value),
					pressure: Number(polyPressure.value),
					channel: channel()
				},
				true
			)
	)

	for (const [name, controller] of CONTROLLERS) {
		const slider = element("input", {
			type: "range",
			min: "0",
			max: "127",
			value: controller === 7 ? "100" : controller === 10 ? "64" : "0"
		})
		slider.addEventListener(EVENT_INPUT, () => controlChange(controller, Number(slider.value)))
		$("#controllers").append(element("label", {}, `${name} (CC ${controller})`, slider))
	}
	const sustain = $<HTMLButtonElement>("#sustain")
	sustain.addEventListener(EVENT_CLICK, () => {
		const on = sustain.getAttribute("aria-pressed") !== "true"
		sustain.setAttribute("aria-pressed", String(on))
		controlChange(64, on ? 127 : 0, false)
	})
	$("#cc-form").addEventListener(EVENT_SUBMIT, (event) => {
		event.preventDefault()
		controlChange(
			Number($<HTMLInputElement>("#cc-number").value),
			Number($<HTMLInputElement>("#cc-value").value),
			false
		)
	})
	$("#program-form").addEventListener(EVENT_SUBMIT, (event) => {
		event.preventDefault()
		void call("midi.programChange", {
			program: Number($<HTMLInputElement>("#program").value),
			channel: channel()
		})
	})
	$("#all-notes-off").addEventListener(
		EVENT_CLICK,
		() => void call("midi.allNotesOff", { channel: channel() })
	)

	let beat: ReturnType<typeof setInterval> | undefined
	const toggleBeat = $<HTMLButtonElement>("#beat")
	toggleBeat.addEventListener(EVENT_CLICK, () => {
		const on = !beat
		toggleBeat.setAttribute("aria-pressed", String(on))
		if (beat) {
			clearInterval(beat)
			beat = undefined
			return
		}
		let position = 0
		const bpm = Number($<HTMLInputElement>("#tempo").value) || 120
		beat = setInterval(
			() => {
				BEAT[position++ % BEAT.length].forEach(drumHit)
			},
			60000 / bpm / 4
		)
	})
}
function drumHit(note: number) {
	noteOn(note, true, 10, 110)
	setTimeout(() => noteOn(note, false, 10, 0), 90)
}

// ── Transport ────────────────────────────────────────────────────────────

function showTransport(data: Json | undefined) {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return
	}
	const { bpm, running, clockSource } = data as {
		bpm: number
		running: boolean
		clockSource: string
	}
	$("#transport-state").textContent =
		`${running ? "▶ playing" : "■ stopped"} · ${Math.round(bpm)} BPM · ${clockSource} clock`
	const tempo = $<HTMLInputElement>("#tempo")
	if (document.activeElement !== tempo) {
		tempo.value = String(Math.round(bpm))
		$("#tempo-value").textContent = String(Math.round(bpm))
	}
}
function buildTransport() {
	for (const node of document.querySelectorAll<HTMLButtonElement>("[data-command]")) {
		node.addEventListener(EVENT_CLICK, async () =>
			showTransport(await call(node.dataset.command!))
		)
	}
	const tempo = $<HTMLInputElement>("#tempo")
	tempo.addEventListener(EVENT_INPUT, () => {
		$("#tempo-value").textContent = tempo.value
	})
	tempo.addEventListener(EVENT_CHANGE, async () =>
		showTransport(await call("transport.setTempo", { bpm: Number(tempo.value) }))
	)
	for (const node of document.querySelectorAll<HTMLButtonElement>("[data-tempo]")) {
		node.addEventListener(EVENT_CLICK, async () => {
			const bpm = Math.min(
				303,
				Math.max(10, Number(tempo.value) + Number(node.dataset.tempo))
			)
			showTransport(await call("transport.setTempo", { bpm }))
		})
	}
	$("#transport-get").addEventListener(EVENT_CLICK, async () =>
		showTransport(await call("transport.get"))
	)
}

// ── Presets ──────────────────────────────────────────────────────────────

let presets: RemotePreset[] = []
async function refreshPresets() {
	presets = has("presets.list")
		? (((await call("presets.list", {}, true)) as unknown as RemotePreset[] | undefined) ?? [])
		: []
	renderPresets()
}
function renderPresets() {
	const query = $<HTMLInputElement>("#preset-search").value.toLowerCase().trim()
	const list = $("#preset-list")
	list.replaceChildren()
	$("#preset-command-missing").hidden = has("presets.load")
	const matches = presets.filter((preset) =>
		query
			.split(/\s+/)
			.every((word) =>
				`${preset.name} ${preset.category} ${preset.description}`
					.toLowerCase()
					.includes(word)
			)
	)
	for (const preset of matches.slice(0, 120)) {
		const load = button(
			preset.name,
			async () => {
				if (
					!preset.remote &&
					!confirm(
						`${preset.name} has no audioBus Protocol input, so this page loses control of Harmoneasy until you open a remote preset again. Load it?`
					)
				) {
					return
				}
				const result = await call("presets.load", { id: preset.id })
				if (result) {
					status(`Loading ${preset.name}; reconnecting…`, "waiting")
				}
			},
			preset.remote ? "preset remote" : "preset"
		)
		load.title = preset.description
		load.append(
			element("small", {
				textContent: `${preset.category}${preset.remote ? " · remote" : ""}`
			})
		)
		list.append(element("li", {}, load))
	}
	$("#preset-count").textContent = `${matches.length} of ${presets.length}`
}
function buildPresets() {
	for (const preset of REMOTE_PRESETS) {
		const row = element(
			"li",
			{},
			button(
				`Load ${preset.name}`,
				async () => {
					if (await call("presets.load", { id: preset.id })) {
						status(`Loading ${preset.name}; reconnecting…`, "waiting")
					}
				},
				"primary"
			),
			button("Reopen Harmoneasy with it", () => open(presetUrl(preset.route)))
		)
		$("#remote-presets").append(row)
	}
	$("#preset-search").addEventListener(EVENT_INPUT, renderPresets)
	$("#preset-refresh").addEventListener(EVENT_CLICK, () => void refreshPresets())
}

// ── Interface controls (ui.list / ui.activate / ui.setValue) ─────────────

let interfaceRevision = 0
async function refreshInterface() {
	const list = $("#controls")
	if (!has("ui.list")) {
		list.replaceChildren(
			element("li", { textContent: "This Harmoneasy build does not offer ui.list." })
		)
		return
	}
	const revision = ++interfaceRevision
	const query = $<HTMLInputElement>("#control-search").value.trim()
	const controls =
		((await call("ui.list", query ? { query } : {}, true)) as unknown as
			UiControl[] | undefined) ?? []
	if (revision !== interfaceRevision) {
		return
	}
	const groups = new Map<string, UiControl[]>()
	for (const control of controls) {
		groups.set(control.context || "Application", [
			...(groups.get(control.context || "Application") ?? []),
			control
		])
	}
	list.replaceChildren(
		...[...groups].map(([context, members]) =>
			element(
				"li",
				{},
				element(
					"details",
					{ open: groups.size <= 6 },
					element("summary", { textContent: `${context} (${members.length})` }),
					element("div", { className: "control-grid" }, ...members.map(interfaceControl))
				)
			)
		)
	)
	$("#control-count").textContent = `${controls.length} controls`
}
function interfaceControl(control: UiControl): HTMLElement {
	const card = element("div", { className: `control control-${control.kind}` })
	const render = (current: UiControl) => {
		card.replaceChildren(
			element("span", {
				className: "control-label",
				textContent: current.label,
				title: current.id
			})
		)
		const update = (result: Json | undefined) => {
			if (result && typeof result === "object" && !Array.isArray(result)) {
				render(result as unknown as UiControl)
			}
		}
		if (current.kind === "action") {
			card.append(
				button("Press", async () => update(await call("ui.activate", { id: current.id })))
			)
		} else if (current.kind === "toggle") {
			const on = current.value === true || current.value === "true" || current.value === "on"
			const toggle = button(
				on ? "On" : "Off",
				async () => update(await call("ui.activate", { id: current.id })),
				"toggle"
			)
			toggle.setAttribute("aria-pressed", String(on))
			card.append(toggle)
		} else if (current.kind === "choice") {
			const select = element("select", { ariaLabel: current.label })
			for (const option of current.options ?? []) {
				select.append(
					new Option(
						option,
						option,
						false,
						option === current.value || String(current.value) === option
					)
				)
			}
			select.addEventListener(EVENT_CHANGE, async () =>
				update(await call("ui.setValue", { id: current.id, value: select.value }))
			)
			card.append(select)
		} else if (current.kind === "number") {
			const slider = element("input", {
				type: "range",
				ariaLabel: current.label,
				value: String(current.value ?? "")
			})
			for (const bound of ["min", "max", "step"] as const) {
				if (current[bound] !== undefined) {
					slider[bound] = String(current[bound])
				}
			}
			slider.value = String(current.value ?? "")
			const output = element("output", { value: String(current.value ?? "") })
			slider.addEventListener(EVENT_INPUT, () => {
				output.value = slider.value
			})
			slider.addEventListener(EVENT_CHANGE, async () =>
				update(await call("ui.setValue", { id: current.id, value: slider.value }))
			)
			card.append(slider, output)
		} else {
			const form = element("form", { className: "inline" })
			const field = element("input", {
				type: "text",
				ariaLabel: current.label,
				value: String(current.value ?? "")
			})
			form.append(field, element("button", { type: "submit", textContent: "Set" }))
			form.addEventListener(EVENT_SUBMIT, async (event) => {
				event.preventDefault()
				update(await call("ui.setValue", { id: current.id, value: field.value }))
			})
			card.append(form)
		}
	}
	render(control)
	return card
}
function buildInterface() {
	let timer: ReturnType<typeof setTimeout> | undefined
	$("#control-search").addEventListener(EVENT_INPUT, () => {
		clearTimeout(timer)
		timer = setTimeout(() => void refreshInterface(), 300)
	})
	$("#control-refresh").addEventListener(EVENT_CLICK, () => void refreshInterface())
}

// ── Every command and property ──────────────────────────────────────────

function parameterEditor(name: string, parameter: Parameter, required: boolean) {
	let editor: HTMLInputElement | HTMLSelectElement
	if (parameter.enum || parameter.type === "boolean") {
		editor = element("select")
		if (!required) {
			editor.append(new Option("—", ""))
		}
		for (const value of parameter.enum ?? [true, false]) {
			editor.append(new Option(String(value), String(value)))
		}
	} else {
		editor = element("input", {
			type: parameter.type === "string" ? "text" : "number",
			required
		})
		if (parameter.type !== "string") {
			editor.step = parameter.type === "integer" ? "1" : "any"
			if (parameter.minimum !== undefined) {
				editor.min = String(parameter.minimum)
			}
			if (parameter.maximum !== undefined) {
				editor.max = String(parameter.maximum)
			}
		}
	}
	editor.name = name
	return element("label", {}, `${name}${required ? "" : " (optional)"}`, editor)
}
function parameterValue(parameter: Parameter, value: string): Json {
	return parameter.type === "boolean"
		? value === "true"
		: parameter.type === "string"
			? value
			: Number(value)
}

async function refreshCommands() {
	if (!peer) {
		return
	}
	try {
		commands = await peer.discover()
	} catch (error) {
		log("•", `Discovery failed: ${errorText(error)}`)
		return
	}
	const missing = ["midi.noteOn", "ui.list", "presets.load"].filter(
		(id) => !commands.some((command) => command.id === id)
	)
	if (missing.length) {
		log(
			"•",
			`This Harmoneasy build lacks ${missing.join(", ")}; related controls will not work.`
		)
	}
	const list = $("#commands")
	list.replaceChildren(
		...commands.map((command) => {
			const form = element("form", { className: "command" })
			const result = element("output")
			form.append(
				element("strong", { textContent: command.title }),
				element("code", { textContent: command.id }),
				element("p", { textContent: command.description })
			)
			const schema = command.inputSchema
			for (const [name, parameter] of Object.entries(schema.properties)) {
				form.append(
					parameterEditor(name, parameter, schema.required?.includes(name) ?? false)
				)
			}
			form.append(
				element("button", {
					type: "submit",
					textContent: "Run",
					disabled: !command.available
				}),
				result
			)
			form.addEventListener(EVENT_SUBMIT, async (event) => {
				event.preventDefault()
				const args: Params = {}
				for (const [name, parameter] of Object.entries(schema.properties)) {
					const editor = form.elements.namedItem(name) as
						HTMLInputElement | HTMLSelectElement
					if (editor.value !== "") {
						args[name] = parameterValue(parameter, editor.value)
					}
				}
				const value = await call(command.id, args)
				result.value = value === undefined ? "failed — see log" : JSON.stringify(value)
			})
			return element("li", { className: command.available ? "" : "unavailable" }, form)
		})
	)
	$("#command-count").textContent = `${commands.length} commands`
	$("#preset-command-missing").hidden = has("presets.load")
}

async function refreshProperties() {
	const list = $("#properties")
	if (!peer?.supports("properties")) {
		list.replaceChildren(
			element("li", { textContent: "Harmoneasy did not negotiate properties." })
		)
		return
	}
	let descriptors: PropertyDescriptor[] = []
	try {
		descriptors = await peer.listProperties()
	} catch (error) {
		log("•", `Listing properties failed: ${errorText(error)}`)
	}
	list.replaceChildren(
		...descriptors.map((property) => {
			const output = element("output", { value: "…" })
			output.dataset.property = property.id
			const read = async () => {
				try {
					output.value = JSON.stringify(await peer!.getProperty(property.id))
				} catch (error) {
					output.value = errorText(error)
				}
			}
			const form = element("form", { className: "inline" })
			const editor = parameterEditor("value", property.schema, true)
			form.append(
				editor,
				element("button", {
					type: "submit",
					textContent: "Set",
					disabled: property.readOnly
				})
			)
			editor.querySelector<HTMLInputElement | HTMLSelectElement>("[name]")!.disabled =
				property.readOnly
			form.addEventListener(EVENT_SUBMIT, async (event) => {
				event.preventDefault()
				const value = (form.elements.namedItem("value") as HTMLInputElement).value
				log("→", `set ${property.id} = ${value}`)
				try {
					output.value = JSON.stringify(
						await peer!.setProperty(property.id, parameterValue(property.schema, value))
					)
				} catch (error) {
					log("•", `Setting ${property.id} failed: ${errorText(error)}`)
				}
			})
			void read()
			return element(
				"li",
				{},
				element("strong", {
					textContent: `${property.title}${property.unit ? ` (${property.unit})` : ""}`
				}),
				element("code", { textContent: property.id }),
				output,
				button("Read", () => void read()),
				form
			)
		})
	)
}

// ── Start ────────────────────────────────────────────────────────────────

buildPlaying()
buildTransport()
buildPresets()
buildInterface()
enable(false)
const parameters = new URLSearchParams(location.search)
$<HTMLInputElement>("#address").value = presetUrl(parameters.get("open") ?? REMOTE_PRESETS[0].route)
$("#open-form").addEventListener(EVENT_SUBMIT, (event) => {
	event.preventDefault()
	open($<HTMLInputElement>("#address").value)
})
for (const preset of REMOTE_PRESETS) {
	$("#quick-open").append(button(preset.name, () => open(presetUrl(preset.route))))
}
$("#reconnect").addEventListener(EVENT_CLICK, () => void connect())
$("#clear-log").addEventListener(EVENT_CLICK, () => $("#log").replaceChildren())
if (opener) {
	document.body.classList.add("opener-mode")
	target = opener
	origin = openerOrigin()
	status("Connecting to the Harmoneasy window that opened this page…", "waiting")
	void connect()
} else {
	open($<HTMLInputElement>("#address").value)
}
