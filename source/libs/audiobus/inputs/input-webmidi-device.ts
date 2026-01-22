/**
 * This is a WebMIDI Device input adapter
 * that takes WebMIDI events and converts them
 * into AudioCommands and dispatches them
 */

import AbstractInput from "./abstract-input.ts"
import { createAudioCommand } from "../audio-command-factory.ts"
import { WebMidi, Input, type NoteMessageEvent, type ControlChangeMessageEvent } from "webmidi"
import { NOTE_OFF, NOTE_ON } from "../../../commands.ts"
import { ALL_MIDI_CHANNELS } from "../midi/midi-channels.ts"

import type { IAudioInput } from "./input-interface.ts"
import type { IAudioCommand } from "../audio-command-interface.ts"

export const WEBMIDI_INPUT_ID = "WebMIDI"

const DEFAULT_OPTIONS = {
	channels: ALL_MIDI_CHANNELS,
	devices: []
}

export default class InputWebMIDIDevice extends AbstractInput implements IAudioInput {

	#midiInputs: Input[] = []
	#midiDevices: Map<string, any> = new Map()
	#webMIDIEnabled: boolean = false

	#subscriptions:Map = new Map()
	#guiEventHandlers: Map<string, EventListener> = new Map()

	// TODO: Implement the config retrieval
	// so expose the methods to control this Input
	
	get name(): string {
		return WEBMIDI_INPUT_ID
	}

	get description(): string {
		return "WebMIDI"
	}

	get isEnabled(): boolean {
		return this.#webMIDIEnabled
	}

	get inputDevices(): Input[] {
		return this.#midiInputs
	}

	constructor(options:Record<string, any> = DEFAULT_OPTIONS ) {
		super(options)
	}

	/**
	 * Enable WebMIDI and connect to all available devices
	 */
	async connect(): Promise<void> {
		try {
			await WebMidi.enable()
			
			console.info("[WebMIDI Input] WebMIDI enabled")

			// Connect to all available input devices...
			// or just to the one specified in option?
			 WebMidi.inputs.forEach((device, index) => {
				// FIXME: Check config and only enable devices that
				// we are looking for rather than every single one
				const subscription = this.connectToMIDIDevice(device, index)
				this.#subscriptions.set( device, subscription )
			})

			this.#webMIDIEnabled = true
			this.setAsConnected()

		} catch (error: any) {
			this.setAsDisconnected()
			console.error("[WebMIDI Input] Failed to enable WebMIDI", error)
			throw error
		}
	}

	/**
	 * Disable WebMIDI and disconnect from all devices
	 */
	async disconnect(): Promise<void> {
		try {
			// Remove all listeners
			this.#midiInputs.forEach((device) => this.disconnectFromMIDIDevice(device))

			// await WebMidi.disable()

			this.#midiInputs = []
			this.#midiDevices.clear()
			this.#webMIDIEnabled = false

			this.setAsDisconnected()

			console.info("[WebMIDI Input] WebMIDI disabled")

		} catch (error: any) {
			console.error("[WebMIDI Input] Failed to disable WebMIDI", error)
			throw error
		}
	}


	/**
	 * Create a GUI that is wired into this Input
	 * that can be used to control this input's config
	 * @returns 
	 */
	async createGui(): Promise<HTMLElement> {
		const container = document.createElement("div")
		
		const label = document.createElement("label")
		label.innerText = "WebMIDI Input"
		container.appendChild(label)

		// Check if MIDI devices are available
		if (WebMidi.inputs.length === 0) {
			const noDevicesMsg = document.createElement("p")
			noDevicesMsg.id = "midi-no-devices-message"
			noDevicesMsg.classList.add("no-midi-input-devices-available")
			noDevicesMsg.innerText = "No MIDI devices available"
			container.appendChild(noDevicesMsg)
			return container
		}

		// MIDI Device Selection
		const deviceLabel = document.createElement("label")
		deviceLabel.innerText = "MIDI Device:"
		container.appendChild(deviceLabel)

		const deviceSelect = document.createElement("select")
		deviceSelect.id = "midi-device-select"
		WebMidi.inputs.forEach((device) => {
			const option = document.createElement("option")
			option.value = device.id
			option.innerText = `${device.manufacturer} ${device.name}`
			deviceSelect.appendChild(option)
		})
		container.appendChild(deviceSelect)

		// Channel Selection
		const channelLabel = document.createElement("label")
		channelLabel.innerText = "Channel:"
		container.appendChild(channelLabel)

		const channelSelect = document.createElement("select")
		channelSelect.id = "midi-channel-select"
		for (let i = 1; i <= 16; i++) {
			const option = document.createElement("option")
			option.value = i.toString()
			option.innerText = `Channel ${i}`
			channelSelect.appendChild(option)
		}
		channelSelect.value = "1"
		container.appendChild(channelSelect)

		// Event Listeners
		const onDeviceChange = (event: Event) => {
			const target = event.target as HTMLSelectElement
			const deviceId = target.value
			console.info("[WebMIDI Input] Device selection changed", { deviceId })
			this.options.selectedDevice = deviceId
		}

		const onChannelChange = (event: Event) => {
			const target = event.target as HTMLSelectElement
			const channel = parseInt(target.value, 10)
			console.info("[WebMIDI Input] Channel selection changed", { channel })
			this.options.selectedChannel = channel
		}

		deviceSelect.addEventListener("change", onDeviceChange)
		channelSelect.addEventListener("change", onChannelChange)

		// Store handlers for cleanup
		this.#guiEventHandlers.set("device-change", onDeviceChange)
		this.#guiEventHandlers.set("channel-change", onChannelChange)

		return container
	}

	async destroyGui(): Promise<void> {
		const deviceSelect = document.getElementById("midi-device-select") as HTMLSelectElement
		const channelSelect = document.getElementById("midi-channel-select") as HTMLSelectElement

		if (deviceSelect && this.#guiEventHandlers.has("device-change")) {
			deviceSelect.removeEventListener("change", this.#guiEventHandlers.get("device-change")!)
		}

		if (channelSelect && this.#guiEventHandlers.has("channel-change")) {
			channelSelect.removeEventListener("change", this.#guiEventHandlers.get("channel-change")!)
		}

		this.#guiEventHandlers.clear()
	}

	/**
	 * Connect to a specific MIDI input device
	 */
	connectToMIDIDevice(device: Input, index: number): Function {
		this.#midiInputs.push(device)
		this.#midiDevices.set(device.id, device)

		const deviceName = `${device.manufacturer} ${device.name}`

		const proxy = (event:MessageEvent|NoteMessageEvent|ControlChangeMessageEvent) => this.onMIDIEvent(event, device, deviceName, index)
		const channels = this.options.channels

		// device.addListener("noteon", proxy, channels)
		// device.addListener("noteoff", proxy, channels)
		// device.addListener("controlchange", proxy, channels)
		// device.addListener("pitchbend", proxy, channels)
		//device.addListener("aftertouch", proxy, channels)
		
		device.addListener("midimessage", proxy, channels)

		const subscription = () => {
			// device.removeListener("noteon", proxy, channels)
			// device.removeListener("noteoff", proxy, channels)
			// device.removeListener("controlchange", proxy, channels)
			// device.removeListener("pitchbend", proxy, channels)
			device.removeListener("midimessage", proxy, channels)
			//device.removeListener("aftertouch", proxy, channels)
		}

		return subscription

		console.info("[WebMIDI Input] Connected to device", { deviceName, index })
	}

	/**
	 * Disconnect from the specific MIDI input device
	 * @param device 
	 */
	disconnectFromMIDIDevice(device: Input): void {
		if (!this.#subscriptions.has(device)){ 
			
			console.info("No device subscribed?", this.#subscriptions)
			return
		}
		const sub = this.#subscriptions.get(device)
		sub()

		this.#midiInputs = this.#midiInputs.filter((d) => d !== device)
		this.#midiDevices.delete(device.id)
		this.#subscriptions.delete(device)

		device.close()
		device.destroy()
	}

	/**
	 * Handle incoming MIDI event from device
	 */
	onMIDIEvent(event: any, device: Input, deviceName: string, index: number): void {
		switch (event.type) {
			case "noteon": {
				const note = event.note?.number
				if (note !== undefined) {
					this.onNoteOn(note, event.velocity, event.channel)
					console.info("[WebMIDI Input] Note On", {
						note,
						velocity: event.velocity,
						channel: event.channel,
						device,
						deviceName
					})
				}
				break
			}

			case "noteoff": {
				const note = event.note?.number
				if (note !== undefined) {
					this.onNoteOff(note, event.channel)
					console.info("[WebMIDI Input] Note Off", {
						note,
						channel: event.channel,
						device,
						deviceName
					})
				}
				break
			}

			case "controlchange": {
				const controlNumber = event.controller?.number
				if (controlNumber !== undefined) {
					this.onControlChange(controlNumber, event.value, event.channel)
					console.info("[WebMIDI Input] Control Change", {
						controlNumber,
						value: event.value,
						channel: event.channel,
						device,
						deviceName
					})
				}
				break
			}

			default:
				console.warn("[WebMIDI Input] Unhandled MIDI event type", { type: event.type })
		}
	}

	/**
	 * Handle Note On event
	 */
	onNoteOn(noteNumber: number, velocity: number, channel: number): void {
		const command: IAudioCommand = createAudioCommand(
			NOTE_ON,
			noteNumber,
			this.now,
			this.name
		)
		command.velocity = velocity

		this.dispatch(command)
	}

	/**
	 * Handle Note Off event
	 */
	onNoteOff(noteNumber: number, channel: number): void {
		const command: IAudioCommand = createAudioCommand(
			NOTE_OFF,
			noteNumber,
			this.now,
			this.name
		)

		this.dispatch(command)
	}

	/**
	 * Handle Control Change event
	 */
	onControlChange(controlNumber: number, value: number, channel: number): void {
		// TODO: Implement CC handling if needed
		console.info("[WebMIDI Input] CC event received", { controlNumber, value, channel })
	}

	/**
	 * Cleanup when destroying the input
	 */
	async destroy(): Promise<void> {
		if (this.#webMIDIEnabled) {
			await this.disconnect()
		}
	}
}