import {
	EMPTY_SCHEMA,
	getProtocolRegistry,
	ProtocolError,
	TOPIC_COMMANDS_CHANGED,
	TOPIC_PROPERTIES_CHANGED,
	TOPIC_PROPERTIES_LIST_CHANGED,
	TOPIC_TRANSPORT_CHANGED
} from "audiobus/io/protocol-registry"

export interface ApplicationCommandHost {
	getTransport(): { bpm: number; running: boolean; clockSource: string }
	canSetTempo(): boolean
	setTempo(bpm: number): void
	transport(action: "start" | "stop"): Promise<void>
	panic(): void
	presets(): Promise<ApplicationPreset[]>
	loadPreset(id: string): Promise<void>
}

export interface ApplicationPreset {
	id: string
	name: string
	category: string
	description: string
	/** Whether the preset has an audioBus Protocol Input, so remote control continues after loading. */
	remote: boolean
}

/** Both the palette and remote inputs invoke these application service handlers. */
export function registerApplicationCommands(
	host: ApplicationCommandHost,
	registry = getProtocolRegistry()
) {
	const publish = () => registry.publish(TOPIC_TRANSPORT_CHANGED, host.getTransport())
	const unregister = [
		registry.register({
			id: "transport.get",
			title: "Read transport state",
			description: "Read tempo in BPM, playback state and clock source",
			inputSchema: EMPTY_SCHEMA,
			execute: () => host.getTransport()
		}),
		registry.register({
			id: "transport.setTempo",
			title: "Set application tempo",
			description: "Set internal clock tempo in beats per minute (10–303)",
			inputSchema: {
				type: "object",
				properties: { bpm: { type: "number", minimum: 10, maximum: 303 } },
				required: ["bpm"],
				additionalProperties: false
			},
			available: () => host.canSetTempo(),
			execute: ({ bpm }) => {
				host.setTempo(bpm as number)
				publish()
				return host.getTransport()
			}
		}),
		...(["start", "stop"] as const).map((action) =>
			registry.register({
				id: `transport.${action}`,
				title:
					action === "start" ? "Start application playback" : "Stop application playback",
				description: `${action === "start" ? "Start" : "Stop"} the application transport`,
				inputSchema: EMPTY_SCHEMA,
				available: () =>
					!["shared", "midi", "dvs"].includes(host.getTransport().clockSource),
				execute: async () => {
					await host.transport(action)
					publish()
					return host.getTransport()
				}
			})
		),
		registry.register({
			id: "app.panic",
			title: "Silence all application notes",
			description: "Release playing notes across all chains",
			inputSchema: EMPTY_SCHEMA,
			execute: () => {
				host.panic()
				return null
			}
		}),
		registry.register({
			id: "presets.list",
			title: "List presets",
			description:
				"Published presets that presets.load applies, optionally filtered by a search",
			inputSchema: {
				type: "object",
				properties: { query: { type: "string", description: "Name, category or text" } },
				additionalProperties: false
			},
			execute: async ({ query }) => {
				const words = String(query ?? "")
					.toLowerCase()
					.split(/\s+/)
					.filter(Boolean)
				return (await host.presets())
					.filter((preset) => {
						const text = Object.values(preset).join(" ").toLowerCase()
						return words.every((word) => text.includes(word))
					})
					.map((preset) => ({ ...preset }))
			}
		}),
		registry.register({
			id: "presets.load",
			title: "Load a preset",
			description:
				"Replace the workspace with a published preset from presets.list. Connections close while it loads; reconnect afterwards",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string", description: "Preset ID from presets.list" } },
				required: ["id"],
				additionalProperties: false
			},
			execute: async ({ id }) => {
				const preset = (await host.presets()).find((item) => item.id === id)
				if (!preset) {
					throw new ProtocolError("invalid_params", `Unknown preset: ${id}`)
				}
				// Reply first: replacing the workspace replaces the Input this request arrived on.
				setTimeout(() => {
					host.loadPreset(preset.id).catch((error) =>
						console.error("Failed to load preset remotely:", error)
					)
				}, 0)
				return { ...preset }
			}
		})
	]
	unregister.push(
		// Subscribers receive current transport state with the subscription, then changes.
		registry.retain(TOPIC_TRANSPORT_CHANGED, () => host.getTransport()),
		registry.registerProperty({
			id: "transport.tempo",
			title: "Tempo",
			description: "Internal clock tempo",
			unit: "BPM",
			schema: { type: "number", minimum: 10, maximum: 303 },
			get: () => host.getTransport().bpm,
			set: async (value) => {
				await registry.call("transport.setTempo", { bpm: value })
			},
			writable: () => host.canSetTempo()
		}),
		registry.registerProperty({
			id: "transport.running",
			title: "Playback running",
			description: "Whether the transport is playing",
			schema: { type: "boolean" },
			get: () => host.getTransport().running
		}),
		registry.registerProperty({
			id: "transport.clockSource",
			title: "Clock source",
			description: "The active transport clock source",
			schema: { type: "string" },
			get: () => host.getTransport().clockSource
		}),
		registry.registerBundle({
			id: "org.audiobus.transport",
			version: 1,
			commands: [
				"transport.get",
				"transport.setTempo",
				"transport.start",
				"transport.stop",
				"app.panic"
			],
			properties: ["transport.tempo", "transport.running", "transport.clockSource"]
		})
	)
	// Include changes made by local controls, external clocks, and room peers.
	const snapshot = () => JSON.stringify([host.getTransport(), host.canSetTempo()])
	let previous = snapshot()
	let properties = host.getTransport()
	const interval = setInterval(() => {
		const current = snapshot()
		if (current === previous) {
			return
		}
		previous = current
		publish()
		registry.publish(TOPIC_COMMANDS_CHANGED, null)
		registry.publish(TOPIC_PROPERTIES_LIST_CHANGED, null)
		const currentProperties = host.getTransport()
		for (const [key, id] of [
			["bpm", "transport.tempo"],
			["running", "transport.running"],
			["clockSource", "transport.clockSource"]
		] as const) {
			if (properties[key] !== currentProperties[key]) {
				registry.publish(TOPIC_PROPERTIES_CHANGED, { id, value: currentProperties[key] })
			}
		}
		properties = currentProperties
	}, 100)
	return () => {
		clearInterval(interval)
		unregister.forEach((remove) => remove())
	}
}
