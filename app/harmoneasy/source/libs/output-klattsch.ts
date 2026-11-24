import { banks, compileString } from "klattsch"
import workletURL from "./klattsch.worklet.js?worker&url"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface"
import { notifyControlSchema } from "audiobus/io/component-ui"
import { EVENT_CONFIGURATION_CHANGED } from "audiobus/events/event-constants"
import type { ControlValue, UiDescriptor } from "control-surface/types"

const RANGES = {
	baseF0: { label: "Audition pitch (Hz)", min: 70, max: 320, step: 1, value: 120 },
	rate: { label: "Rate (ms / phoneme)", min: 60, max: 240, step: 1, value: 110 },
	scale: { label: "Formant scale", min: 0.7, max: 1.5, step: 0.01, value: 1 },
	vibratoDepth: { label: "Vibrato depth (Hz)", min: 0, max: 15, step: 0.5, value: 0 },
	vibratoRate: { label: "Vibrato rate (Hz)", min: 2, max: 10, step: 0.1, value: 5 },
	tremoloDepth: { label: "Tremolo depth", min: 0, max: 1, step: 0.01, value: 0 },
	tremoloRate: { label: "Tremolo rate (Hz)", min: 0.5, max: 15, step: 0.1, value: 5 },
	aspiration: { label: "Breathiness", min: 0, max: 1, step: 0.01, value: 0 },
	tilt: { label: "Spectral tilt", min: -0.9, max: 0.9, step: 0.01, value: 0 },
	effort: { label: "Vocal effort", min: 0, max: 1, step: 0.01, value: 0.5 },
	volume: { label: "Output volume", min: 0, max: 1.5, step: 0.01, value: 1 }
} as const

type NumericSetting = keyof typeof RANGES
type Settings = Record<NumericSetting, number> & { phonemes: string; bank: string }
interface Options extends Partial<Settings> {
	audioContext?: AudioContext
	destination?: AudioNode
	mixer?: GainNode
}
const loadedContexts = new WeakMap<AudioContext, Promise<void>>()
const MAX_NOTES = 16

export default class OutputKlattsch extends EventTarget implements IAudioOutput {
	readonly uuid = `Output-Klattsch-${crypto.randomUUID()}`
	readonly name = "Klattsch"
	readonly description = "Retro formant speech and singing from editable phoneme sequences"
	readonly isHidden = false
	readonly configurationAffectsNoteRouting = false
	readonly output: GainNode
	#context: AudioContext
	#connected = false
	#destroyed = false
	#connectionGeneration = 0
	#settings: Settings
	#voices = new Map<number, { node: AudioWorkletNode; gain: GainNode }>()

	constructor(options: Options = {}) {
		super()
		if (!options.audioContext) {
			throw new Error("Klattsch requires an audio context")
		}
		this.#context = options.audioContext
		this.#settings = {
			...Object.fromEntries(Object.entries(RANGES).map(([id, range]) => [id, range.value])),
			phonemes: "HH AH L OW",
			bank: "klatt1980-en"
		} as Settings
		for (const [id, value] of Object.entries(options)) {
			this.setControlValue(id, value as ControlValue)
		}
		this.output = this.#context.createGain()
		this.output.gain.value = this.#settings.volume
		this.output.connect(options.mixer ?? options.destination ?? this.#context.destination)
	}

	get isConnected(): boolean {
		return this.#connected
	}
	get options(): Settings {
		return { ...this.#settings }
	}
	hasAudioOutput(): boolean {
		return true
	}
	hasMidiOutput(): boolean {
		return false
	}

	async connect(): Promise<void> {
		if (this.#destroyed) {
			throw new Error("Klattsch has been destroyed")
		}
		const generation = ++this.#connectionGeneration
		if (this.#context.state === "suspended") {
			await this.#context.resume()
		}
		let loading = loadedContexts.get(this.#context)
		if (!loading) {
			loading = this.#context.audioWorklet.addModule(workletURL)
			loadedContexts.set(this.#context, loading)
			loading.catch(() => loadedContexts.delete(this.#context))
		}
		await loading
		this.#connected = !this.#destroyed && generation === this.#connectionGeneration
	}

	#play(
		key: number,
		frequency: number,
		velocity: number,
		phonemes = this.#settings.phonemes
	): void {
		if (!this.#connected || this.#destroyed) {
			return
		}
		const { voices, totalMs } = compileString(phonemes, {
			...this.#settings,
			baseF0: frequency
		})
		this.noteOff(key)
		if (this.#voices.size >= MAX_NOTES) {
			this.noteOff(this.#voices.keys().next().value!)
		}
		const node = new AudioWorkletNode(this.#context, "harmoneasy-klattsch", {
			numberOfInputs: 0,
			numberOfOutputs: voices.length,
			outputChannelCount: voices.map(() => 1),
			processorOptions: { voices, totalMs }
		})
		const gain = this.#context.createGain()
		gain.gain.value = Math.min(127, Math.max(0, velocity)) / 127
		voices.forEach((_, index) => node.connect(gain, index))
		gain.connect(this.output)
		this.#voices.set(key, { node, gain })
		node.port.onmessage = () => {
			if (this.#voices.get(key)?.node === node) {
				this.noteOff(key)
			}
		}
	}

	noteOn(note: number, velocity = 100): void {
		if (!Number.isFinite(note) || !Number.isFinite(velocity)) {
			return
		}
		if (velocity <= 0) {
			this.noteOff(note)
			return
		}
		this.#play(note, 440 * 2 ** ((note - 69) / 12), velocity)
	}

	noteOff(note: number): void {
		const voice = this.#voices.get(note)
		if (!voice) {
			return
		}
		voice.node.port.postMessage("stop")
		voice.node.port.onmessage = null
		voice.node.disconnect()
		voice.node.port.close()
		voice.gain.disconnect()
		this.#voices.delete(note)
	}

	allNotesOff(): void {
		for (const note of this.#voices.keys()) {
			this.noteOff(note)
		}
	}

	async disconnect(): Promise<void> {
		this.#connectionGeneration++
		this.#connected = false
		this.allNotesOff()
	}

	destroy(): void {
		this.#destroyed = true
		this.#connected = false
		this.allNotesOff()
		this.output.disconnect()
	}

	getUiDescriptor(): UiDescriptor {
		return {
			title: this.name,
			controls: [
				{
					id: "phonemes",
					label: "Phoneme sequence",
					widget: "text",
					group: "Speech",
					defaultValue: "HH AH L OW",
					help: "ARPABET, e.g. HH AH L OW. MIDI notes set pitch; inline b/r/s directives override defaults."
				},
				{ id: "speak", label: "Speak", widget: "button", group: "Speech" },
				{ id: "stop", label: "Stop", widget: "button", group: "Speech" },
				{
					id: "bank",
					label: "Phoneme bank",
					widget: "select",
					group: "Speech",
					choices: banks
						.list()
						.map((value) => ({ label: banks.get(value)!.displayName, value })),
					defaultValue: "klatt1980-en"
				},
				...Object.entries(RANGES).map(([id, range]) => ({
					id,
					label: range.label,
					widget: "slider" as const,
					group: "Voice",
					min: range.min,
					max: range.max,
					step: range.step,
					defaultValue: range.value
				})),
				...Object.keys(banks.get(this.#settings.bank)!.phonemes).map((phoneme) => ({
					id: `audition:${phoneme}`,
					label: phoneme,
					widget: "button" as const,
					group: "Audition phonemes"
				}))
			]
		}
	}

	getControlValue(id: string): ControlValue | undefined {
		return this.#settings[id as keyof Settings]
	}

	setControlValue(id: string, value: ControlValue): void {
		if (id === "speak" || id.startsWith("audition:")) {
			this.#play(
				-1,
				this.#settings.baseF0,
				127,
				id === "speak" ? this.#settings.phonemes : id.slice(9)
			)
			return
		}
		if (id === "stop") {
			this.allNotesOff()
			return
		}
		if (id === "phonemes" && typeof value === "string") {
			this.#settings.phonemes = value
		} else if (id === "bank" && typeof value === "string" && banks.list().includes(value)) {
			this.#settings.bank = value
			notifyControlSchema(this)
		} else if (
			Object.hasOwn(RANGES, id) &&
			typeof value === "number" &&
			Number.isFinite(value)
		) {
			const range = RANGES[id as NumericSetting]
			this.#settings[id as NumericSetting] = Math.min(range.max, Math.max(range.min, value))
			if (id === "volume" && this.output) {
				this.output.gain.value = this.#settings.volume
			}
		} else {
			return
		}
		this.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED))
	}

	subscribeControls(listener: () => void): () => void {
		this.addEventListener(EVENT_CONFIGURATION_CHANGED, listener)
		return () => this.removeEventListener(EVENT_CONFIGURATION_CHANGED, listener)
	}
}