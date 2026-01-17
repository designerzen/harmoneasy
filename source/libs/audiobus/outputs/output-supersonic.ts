import { SuperSonic } from "supersonic-scsynth-bundle"
import type { IAudioOutput } from "./output-interface"

// export const superSonic = new OutputSuperSonic()

/**
 * SuperSonic SC Synth Audio Engine
 * Handles initialization and lifecycle of the SuperCollider audio server
 * Based on: https://github.com/samaaron/supersonic/blob/main/docs/API.md
 */
export class OutputSuperSonic implements IAudioOutput{

	static ID:number = 0

	private supersonic: SuperSonic | null = null

	#uuid:string

	get uuid(): string {
		return this.#uuid
	}

	get name():string {
		return "OutputSuperSonic"
	}

	get description():string {
		return "SuperSonic SC Synth"
	}
	
	/**
	 * Get the Web Audio AudioContext
	 */
	get audioContext(): AudioContext {
		const ctx = this.getSupersonic().audioContext
		if (!ctx) {
			throw new Error("AudioContext not available")
		}
		return ctx
	}

	/**
	 * Check if engine is initialized and ready (read-only property)
	 */
	get isInitialised(): boolean {
		return this.supersonic !== null && this.supersonic.initialized
	}

	/**
	 * Check if engine is currently initializing (read-only property)
	 */
	get isInitialising(): boolean {
		return this.supersonic !== null && this.supersonic.initializing
	}

	constructor() {
		this.#uuid = "Output-SuperSonic-"+(OutputSuperSonic.ID++)
	}

	// FIXME:
	noteOn(noteNumber:number, velocity: number): void {
		throw new Error("Method noteOn not implemented.")
	}
	noteOff(noteNumber: number): void {
		throw new Error("Method noteOff not implemented.")
	}
	allNotesOff(): void {
		throw new Error("Method allNotesOff not implemented.")
	}

	/**
	 * Initialize the SuperSonic audio engine
	 * Must be called after user interaction (click, tap, keypress)
	 * Requires COOP/COEP headers for SharedArrayBuffer support
	 * @throws Error if initialization fails or if already initializing
	 */
	async init(): Promise<SuperSonic> {
		// Return early if already initialized
		if (this.isInitialised) {
			return this.supersonic!
		}

		// Return existing init if already in progress
		if (this.isInitialising) {
			// Wait for existing initialization to complete
			return new Promise((resolve, reject) => {
				const checkReady = setInterval(() => {
					if (this.isInitialised) {
						clearInterval(checkReady)
						resolve(this.supersonic!)
					}
				}, 100)
				// Timeout after 30s
				setTimeout(() => {
					clearInterval(checkReady)
					reject(new Error("SuperSonic initialization timeout"))
				}, 30000)
			})
		}

		try {
			// Create SuperSonic instance with base URL for assets
			this.supersonic = new SuperSonic({
				baseURL: "/supersonic/",
				scsynthOptions: {
					numBuffers: 4096,
				},
			})

			// Subscribe to detailed lifecycle events
			this.setupAudioEngineListeners()

			// Initialize the engine
			await this.supersonic.init({
				audioContextOptions: {
					latencyHint: "playback",
				},
			})

			return this.supersonic
		} catch (error) {
			console.error("Failed to initialize SuperSonic:", error)
			this.supersonic = null
			throw error
		}
	}

	/**
	 * Get the initialized SuperSonic instance
	 * @throws Error if not initialized
	 */
	getSupersonic(): SuperSonic {
		if (!this.supersonic) {
			throw new Error("SuperSonic not initialised. Call init() first.")
		}
		return this.supersonic
	}


	/**
	 * Get set of loaded SynthDef names
	 */
	getLoadedSynthDefs(): Set<string> {
		return this.getSupersonic().loadedSynthDefs
	}

	/**
	 * Get boot statistics
	 */
	getBootStats(): Record<string, any> {
		return this.getSupersonic().bootStats
	}

	/**
	 * Get static engine configuration
	 */
	getInfo(): Record<string, any> {
		return this.getSupersonic().getInfo()
	}

	/**
	 * Load a SynthDef for use
	 * @param nameOrPath - Synthdef name (uses synthdefBaseURL) or full path
	 * @throws Error if synthdef fails to load
	 */
	async loadSynthDef(nameOrPath: string): Promise<{ name: string; size: number }> {
		const ss = this.getSupersonic()

		try {
			const info = await ss.loadSynthDef(nameOrPath)
			console.info(`Loaded synthdef: ${info.name} (${info.size} bytes)`)
			return info
		} catch (error) {
			console.error(`Failed to load synthdef ${nameOrPath}:`, error)
			throw error
		}
	}

	/**
	 * Load multiple SynthDefs in parallel
	 * @param names - Array of synthdef names
	 * @returns Results map with success status for each synthdef
	 */
	async loadSynthDefs(names: string[]): Promise<Record<string, any>> {
		const ss = this.getSupersonic()

		const results = await ss.loadSynthDefs(names)

		// Log results and validate
		let successCount = 0
		for (const [name, result] of Object.entries(results)) {
			if (result.success) {
				console.info(`Loaded synthdef: ${name}`)
				successCount++
			} else {
				console.error(`Failed to load synthdef ${name}:`, result.error)
			}
		}

		console.info(`Loaded ${successCount}/${names.length} synthdefs`)
		return results
	}

	/**
	 * Sync - Wait for all async commands to complete
	 * @param syncId - Optional unique identifier for this sync command
	 */
	async sync(syncId?: number): Promise<void> {
		const ss = this.getSupersonic()
		await ss.sync(syncId)
	}

	/**
	 * Send an OSC message to the server
	 * Types are auto-detected from JavaScript values
	 * @param address - OSC address (e.g., '/s_new')
	 * @param args - Variable arguments
	 */
	send(address: string, ...args: any[]): void {
		const ss = this.getSupersonic()
		ss.send(address, ...args)
	}

	/**
	 * Get node tree snapshot (all running synths and groups)
	 */
	getTree(): Record<string, any> {
		const ss = this.getSupersonic()
		return ss.getTree()
	}

	/**
	 * Get metrics snapshot on demand
	 */
	getMetrics(): Record<string, any> {
		const ss = this.getSupersonic()
		return ss.getMetrics()
	}

	/**
	 * Set metrics polling interval
	 * @param ms - Interval in milliseconds
	 */
	setMetricsInterval(ms: number): void {
		const ss = this.getSupersonic()
		ss.setMetricsInterval(ms)
	}

	/**
	 * Stop metrics polling
	 */
	stopMetricsPolling(): void {
		const ss = this.getSupersonic()
		ss.stopMetricsPolling()
	}

	/**
	 * Subscribe to an event
	 * @returns Unsubscribe function
	 */
	on(event: string, callback: (data: any) => void): () => void {
		const ss = this.getSupersonic()
		return ss.on(event, callback)
	}

	/**
	 * Unsubscribe from an event
	 */
	off(event: string, callback: (data: any) => void): void {
		const ss = this.getSupersonic()
		ss.off(event, callback)
	}

	/**
	 * Subscribe to an event once
	 * @returns Unsubscribe function
	 */
	once(event: string, callback: (data: any) => void): () => void {
		const ss = this.getSupersonic()
		return ss.once(event, callback)
	}

	/**
	 * Remove all listeners for an event (or all events)
	 */
	removeAllListeners(event?: string): void {
		const ss = this.getSupersonic()
		ss.removeAllListeners(event)
	}

	/**
	 * Shutdown the audio engine (preserves listeners, can reinit)
	 */
	async shutdown(): Promise<void> {
		if (this.supersonic) {
			await this.supersonic.shutdown()
		}
	}

	/**
	 * Permanently destroy the audio engine
	 */
	async destroy(): Promise<void> {
		if (this.supersonic) {
			await this.supersonic.destroy()
			this.supersonic = null
			this.#connected = false
		}
	}

	/**
	 * Recover from audio interruption (browser suspension, etc)
	 */
	async recover(): Promise<boolean> {
		if (!this.supersonic) {
			throw new Error("SuperSonic not initialised. Call init() first.")
		}

		const isRunning = await this.supersonic.recover()
		console.info("Audio recovery:", isRunning ? "successful" : "failed")
		return isRunning
	}

	/**
	 * Setup SuperSonic engine event listeners
	 */
	private setupAudioEngineListeners(): void {
		if (!this.supersonic) return

		// Engine ready
		this.supersonic.on("ready", (info) => {
			console.info("SuperSonic ready", {
				sampleRate: info.sampleRate,
				bootTime: info.bootTimeMs,
			})
		})

		// Error handling
		this.supersonic.on("error", (error) => {
			console.error("SuperSonic error:", error)
		})

		// Asset loading progress
		this.supersonic.on("loading:start", ({ type, name }) => {
			console.info(`Loading ${type}: ${name}`)
		})

		this.supersonic.on("loading:complete", ({ type, name, size }) => {
			console.info(`Loaded ${type}: ${name} (${size} bytes)`)
		})

		// Debug output from scsynth
		this.supersonic.on("debug", ({ text }) => {
			console.debug("[scsynth]", text)
		})

		// Lifecycle events
		this.supersonic.on("shutdown", () => {
			console.info("SuperSonic shutdown")
		})

		this.supersonic.on("destroy", () => {
			console.info("SuperSonic destroyed")
			this.supersonic = null
		})

		// AudioContext state changes
		this.supersonic.on("audiocontext:suspended", () => {
			console.warn("Audio suspended - user interaction needed to resume")
		})

		this.supersonic.on("audiocontext:resumed", () => {
			console.info("Audio resumed")
		})

		this.supersonic.on("audiocontext:interrupted", () => {
			console.warn("Audio interrupted by system")
		})

		this.setupGlobalEventListeners()
	}

	/**
	 * Setup global DOM event listeners
	 */
	private setupGlobalEventListeners(): void {
		// Handle audio context suspension (browser tab backgrounded)
		document.addEventListener("visibilitychange", async () => {
			if (!document.hidden && this.supersonic?.initialized) {
				console.info("Tab became visible, recovering audio...")
				try {
					await this.recover()
				} catch (error) {
					console.error("Audio recovery failed:", error)
				}
			}
		})

		// Handle page unload
		window.addEventListener("beforeunload", async () => {
			if (this.supersonic) {
				await this.shutdown()
			}
		})
	}
}