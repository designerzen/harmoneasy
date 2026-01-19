import { midiNoteToFrequency } from "../conversion/note-to-frequency.ts"
import type { IAudioOutput } from "./output-interface.ts"

interface Config {
	enabled: number // 1 for on, 0 for off
	frequency: number // Base frequency for the voice
	loudness: number // 0-1, volume of the synthesis
	tenseness: number // 0-1, controls voiced/voiceless balance
	vibratoFrequency: number // Vibrato modulation frequency
	vibratoGain: number // Vibrato depth
	vibratoWobble: number // Vibrato wobble
}

const DEFAULT_OPTIONS: Config = {
	enabled: 1,
	frequency: 100,
	loudness: 1,
	tenseness: 0.6,
	vibratoFrequency: 5,
	vibratoGain: 0,
	vibratoWobble: 0
}



/**
 * OutputPinkTrombone
 *
 * Integrates Pink Trombone (vocal synthesis engine) for speech-like sound generation.
 * Maps MIDI notes to vocal tract frequencies and controls synthesis parameters.
 */
export default class OutputPinkTrombone extends EventTarget implements IAudioOutput {

	static ID: number = 0

	#uuid: string
	#config: Config
	#pinkTromboneElement: HTMLElement | null = null
	#audioContext: AudioContext | null = null
	#activeNotes: Map<number, number> = new Map() // noteNumber -> frequency mapping
	#isInitialized: boolean = false

	get uuid(): string {
		return this.#uuid
	}

	get name(): string {
		return 'Pink Trombone'
	}

	get description(): string {
		return 'Vocal synthesis using Pink Trombone'
	}

	get isConnected(): boolean {
		return this.#isInitialized
	}

	constructor(config: Partial<Config> = DEFAULT_OPTIONS) {
		super()
		this.#uuid = "Output-Pink-Trombone-" + (OutputPinkTrombone.ID++)
		this.#config = { ...DEFAULT_OPTIONS, ...config }
		this.initialise()
	}

	/**
	 * Initialize Pink Trombone element and Audio Context
	 */
	private initialise(): void {
		if (typeof window === 'undefined') {
			return
		}

		try {
			// Create or find Pink Trombone element
			let element = document.querySelector('pink-trombone')

			if (!element) {
				element = document.createElement('pink-trombone')
				document.body.appendChild(element)
			}

			this.#pinkTromboneElement = element as HTMLElement

			// Create AudioContext
			this.#audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

			// Wait for Pink Trombone to load
			this.#pinkTromboneElement.addEventListener('load', () => {
				this.onPinkTromboneLoaded()
			})

			// If already loaded, trigger initialization
			if ((this.#pinkTromboneElement as any).audioContext) {
				this.onPinkTromboneLoaded()
			}
		} catch (error) {
			console.debug('[PINK-TROMBONE] Initialization failed:', error)
		}
	}

	/**
	 * Handle Pink Trombone loaded event
	 */
	private onPinkTromboneLoaded(): void {
		if (!this.#pinkTromboneElement || !this.#audioContext) {
			return
		}

		try {
			const element = this.#pinkTromboneElement as any

			// Set the audio context
			Promise.resolve(element.setAudioContext(this.#audioContext)).then(() => {
				// Connect to audio destination
				element.connect(this.#audioContext!.destination)

				// Set initial parameters
				this.updateSynthesisParameters()

				this.#isInitialized = true
				this.dispatchEvent(new CustomEvent('connected'))

				console.debug('[PINK-TROMBONE] Initialized successfully')
			}).catch((error: Error) => {
				console.debug('[PINK-TROMBONE] Failed to setup audio:', error)
			})
		} catch (error) {
			console.debug('[PINK-TROMBONE] Error in onPinkTromboneLoaded:', error)
		}
	}

	/**
	 * Update synthesis parameters
	 */
	private updateSynthesisParameters(): void {
		if (!this.#pinkTromboneElement || !this.#isInitialized) {
			return
		}

		try {
			const element = this.#pinkTromboneElement as any

			if (element.loudness) {
				element.loudness.value = this.#config.loudness
			}

			if (element.tenseness) {
				element.tenseness.value = this.#config.tenseness
			}

			if (element.vibrato) {
				if (element.vibrato.frequency) {
					element.vibrato.frequency.value = this.#config.vibratoFrequency
				}
				if (element.vibrato.gain) {
					element.vibrato.gain.value = this.#config.vibratoGain
				}
				if (element.vibrato.wobble) {
					element.vibrato.wobble.value = this.#config.vibratoWobble
				}
			}
		} catch (error) {
			console.debug('[PINK-TROMBONE] Failed to update parameters:', error)
		}
	}

	/**
	 * Start Pink Trombone voice synthesis
	 */
	private startSynthesis(): void {
		if (!this.#pinkTromboneElement || !this.#config.enabled || !this.#isInitialized) {
			return
		}

		try {
			const element = this.#pinkTromboneElement as any
			if (element.start && typeof element.start === 'function') {
				element.start()
			}
		} catch (error) {
			console.debug('[PINK-TROMBONE] Failed to start synthesis:', error)
		}
	}

	/**
	 * Stop Pink Trombone voice synthesis
	 */
	private stopSynthesis(): void {
		if (!this.#pinkTromboneElement || !this.#isInitialized) {
			return
		}

		try {
			const element = this.#pinkTromboneElement as any
			if (element.stop && typeof element.stop === 'function') {
				element.stop()
			}
		} catch (error) {
			console.debug('[PINK-TROMBONE] Failed to stop synthesis:', error)
		}
	}

	/**
	 * Set vocal tract constriction based on note
	 * Maps different notes to different vocal tract configurations for varied phonemes
	 */
	private setVocalConstriction(noteNumber: number): void {
		if (!this.#pinkTromboneElement || !this.#isInitialized) {
			return
		}

		try {
			const element = this.#pinkTromboneElement as any

			// Map notes to different constriction positions
			// Creates variation in the vocal tract shape
			const normalizedNote = noteNumber % 12 // Get pitch class (0-11)
			const index = 20 + (normalizedNote / 12) * 20 // Range: 20-40
			const diameter = 1 + Math.sin(normalizedNote / 12 * Math.PI) * 2 // Vary diameter 0.3-3

			if (element.tongue) {
				if (element.tongue.index) {
					element.tongue.index.value = index
				}
				if (element.tongue.diameter) {
					element.tongue.diameter.value = diameter
				}
			}
		} catch (error) {
			console.debug('[PINK-TROMBONE] Failed to set vocal constriction:', error)
		}
	}

	/**
	 * Activate synthesis for a note
	 * Sets frequency and vocal tract configuration
	 */
	noteOn(noteNumber: number, velocity: number): void {
		if (!this.#config.enabled || !this.#isInitialized) {
			return
		}

		try {
			const frequency = midiNoteToFrequency(noteNumber)

			// Track active notes
			this.#activeNotes.set(noteNumber, frequency)

			// Start synthesis on first note
			if (this.#activeNotes.size === 1) {
				this.startSynthesis()
			}

			// Set frequency
			const element = this.#pinkTromboneElement as any
			if (element.frequency) {
				element.frequency.value = frequency
			}

			// Adjust loudness based on velocity
			if (element.loudness) {
				element.loudness.value = (velocity / 127) * this.#config.loudness
			}

			// Update vocal tract for this note
			this.setVocalConstriction(noteNumber)
		} catch (error) {
			console.debug('[PINK-TROMBONE] Note on failed:', error)
		}
	}

	/**
	 * Deactivate synthesis for a note
	 */
	noteOff(noteNumber: number): void {
		try {
			this.#activeNotes.delete(noteNumber)

			// Stop synthesis when all notes are released
			if (this.#activeNotes.size === 0) {
				this.stopSynthesis()
			} else if (this.#activeNotes.size > 0) {
				// If there are still active notes, use the highest frequency
				let highestFrequency = 0
				for (const freq of this.#activeNotes.values()) {
					if (freq > highestFrequency) {
						highestFrequency = freq
					}
				}

				const element = this.#pinkTromboneElement as any
				if (element.frequency && highestFrequency > 0) {
					element.frequency.value = highestFrequency
				}
			}
		} catch (error) {
			console.debug('[PINK-TROMBONE] Note off failed:', error)
		}
	}

	/**
	 * Stop all active notes
	 */
	allNotesOff(): void {
		try {
			this.#activeNotes.clear()
			this.stopSynthesis()
		} catch (error) {
			console.debug('[PINK-TROMBONE] All notes off failed:', error)
		}
	}

	/**
	 * Connect to audio context (optional)
	 */
	connect(): Promise<void> {
		return new Promise((resolve) => {
			if (this.#isInitialized) {
				resolve()
			} else {
				this.addEventListener('connected', () => resolve(), { once: true })
			}
		})
	}

	/**
	 * Disconnect from audio context (optional)
	 */
	disconnect(): void {
		this.allNotesOff()
		this.#activeNotes.clear()
	}
}

// Add type declaration for pink-trombone element
declare global {
	namespace JSX {
		interface IntrinsicElements {
			'pink-trombone': any
		}
	}
}
