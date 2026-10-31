import { DEFAULT_PRESET_LIBRARY as catalogue } from "./factory-preset-data"
import type { PresetSetup, TransformerPreset } from "audiobus/io/preset-library"
import arcana from "../../public/preset/hardware/arcana/strum/preset.json"
import cosmo from "../../public/preset/hardware/cosmo/dots/preset.json"
import { PRESET_VOICES, setupSurfaces } from "./preset-instruments"

interface Layer {
	name: string
	voice: string
	recipes: string[]
}
interface Performance {
	id: string
	name: string
	description: string
	play: string
	bpm: number
	bars?: number
	input: string
	inputOptions?: Record<string, unknown>
	layers: Layer[]
	groove?: string
}

const PERFORMANCES: Performance[] = [
	{
		id: "genres/electro/live-set",
		name: "Electro Switchyard Live Set",
		bpm: 125,
		bars: 16,
		input: "keyboard",
		groove: "electro",
		description:
			"A sixteen-bar electro performance rig with clipped saw bass, syncopated square-wave chords and a wandering high bell counterline.",
		play: "Start transport for the electro drums. Play roots in the middle register, bring up the offbeat chords for the second eight bars, then introduce the bell line. Shape each filter and layer level on its own control surface.",
		layers: [
			{
				name: "Switchyard bass",
				voice: "bass",
				recipes: ["low-minor-pulse", "expressive-contour"]
			},
			{
				name: "Offbeat circuits",
				voice: "reed",
				recipes: ["dub-stabs", "smooth-chord-voices", "expressive-contour"]
			},
			{
				name: "Signal reflections",
				voice: "bell",
				recipes: [
					"a-minor-nocturne",
					"three-five-weave",
					"orbiting-pitch-classes",
					"upper-octave-sparkle",
					"soft-echo-trail"
				]
			}
		]
	},
	{
		id: "sequencer/clockwork-orchard",
		name: "Sequencer Clockwork Orchard",
		bpm: 104,
		bars: 16,
		input: "step-sequencer",
		groove: "electro",
		description:
			"Sequence roots into clipped bass, strummed chords and a high evolving bell pattern, each on its own chain.",
		play: "Enter notes in the step sequencer and start transport. Build a sixteen-bar arrangement by bringing the three voices in and out with their volume controls.",
		layers: [
			{
				name: "Clockwork roots",
				voice: "bass",
				recipes: ["bass-register", "minimal-motion", "expressive-contour"]
			},
			{
				name: "Orchard strings",
				voice: "pluck",
				recipes: ["c-major-sketchbook", "gentle-strummed-chords", "smooth-chord-voices"]
			},
			{
				name: "Canopy bells",
				voice: "bell",
				recipes: ["staccato-arp", "woven-register", "soft-echo-trail"]
			}
		]
	},
	{
		id: "microphone/percussive-fireflies",
		name: "Microphone Percussive Fireflies",
		bpm: 122,
		bars: 8,
		input: "microphone-trigger",
		groove: "electro",
		description:
			"Claps or taps trigger short octave sparks and soft delayed bass answers over an electro rhythm.",
		play: "Enable the microphone trigger and adjust its threshold in the input panel. Use headphones, clap or tap near the microphone, and start transport for the drum layer.",
		layers: [
			{
				name: "Firefly sparks",
				voice: "bell",
				recipes: [
					"c-major-sketchbook",
					"orbiting-pitch-classes",
					"expressive-contour",
					"soft-echo-trail"
				]
			},
			{
				name: "Tap responses",
				voice: "bass",
				recipes: ["bass-register", "minimal-motion", "two-note-shadow"]
			}
		]
	},
	{
		id: "ble-midi/pocket-ensemble",
		name: "Bluetooth Pocket Ensemble",
		bpm: 96,
		bars: 8,
		input: "ble-midi",
		description:
			"A wireless MIDI controller plays a warm chord ensemble with a separate remembered bass voice.",
		play: "Pair a Bluetooth MIDI controller in the input panel on a supported browser. Use the onscreen keys to audition before pairing; play sparse roots for the chord and bass arrangement.",
		layers: [
			{
				name: "Pocket chords",
				voice: "pluck",
				recipes: ["d-dorian-session", "smooth-chord-voices", "gentle-strummed-chords"]
			},
			{
				name: "Wireless bass",
				voice: "bass",
				recipes: ["d-dorian-session", "two-note-shadow", "bass-register", "minimal-motion"]
			}
		]
	},
	{
		id: "scale-explorer/modal-lanterns",
		name: "Scale Explorer Modal Lanterns",
		bpm: 88,
		bars: 8,
		input: "scale-explorer",
		description:
			"Explore Dorian colour through interwoven reed and high bell lines with a slow sustained foundation.",
		play: "Choose notes in Scale Explorer, repeat a short motif and listen to the octaves evolve. Mix the three voices independently as you explore.",
		layers: [
			{
				name: "Modal reeds",
				voice: "reed",
				recipes: ["d-dorian-session", "expressive-contour", "woven-register"]
			},
			{
				name: "Lantern light",
				voice: "bell",
				recipes: ["d-dorian-session", "upper-octave-sparkle", "soft-echo-trail"]
			},
			{
				name: "Dorian foundation",
				voice: "pad",
				recipes: ["d-dorian-session", "open-fifth-bloom"]
			}
		]
	},
	{
		id: "leap-motion/aurora",
		name: "Leap Motion Aurora",
		bpm: 68,
		bars: 8,
		input: "leap-motion",
		description:
			"Hand position blooms into a slow minor pad while an independent bell voice remembers earlier gestures.",
		play: "Connect Leap Motion with its browser SDK available. Move left/right for pitch and lift your hand for velocity; leave space for the bloom and echoes.",
		layers: [
			{
				name: "Aurora bloom",
				voice: "pad",
				recipes: ["a-minor-nocturne", "slow-chord-bloom", "expressive-contour"]
			},
			{
				name: "Remembered light",
				voice: "bell",
				recipes: [
					"a-minor-nocturne",
					"two-note-shadow",
					"upper-octave-sparkle",
					"soft-echo-trail"
				]
			}
		]
	},
	{
		id: "magic-mouse/prism",
		name: "Magic Mouse Prism",
		bpm: 108,
		bars: 8,
		input: "music-mouse",
		inputOptions: { onlyWhileMouseDown: true, octaves: 2 },
		description:
			"A mouse or trackpad plays a pentatonic pluck against a slower, orbiting reed counterline.",
		play: "Drag in the Music Mouse panel to play (Magic Mouse and other pointer devices work). Horizontal motion selects notes; vertical motion changes register. Release to stop the gesture.",
		layers: [
			{
				name: "Prismatic plucks",
				voice: "pluck",
				recipes: ["pentatonic-shadow", "expressive-contour", "soft-echo-trail"]
			},
			{
				name: "Orbiting reeds",
				voice: "reed",
				recipes: [
					"c-major-sketchbook",
					"three-five-weave",
					"orbiting-pitch-classes",
					"minimal-motion"
				]
			}
		]
	},
	{
		id: "gamepad/neon-arcade",
		name: "Gamepad Neon Arcade",
		bpm: 128,
		input: "gamepad-music",
		groove: "electro",
		description:
			"Gamepad gestures drive clipped bass and a bright fifth-stacked melody above an electro beat.",
		play: "Connect a gamepad and press a button to make it available to the browser. Play notes in the input panel; start transport for drums and mix the layers on their surfaces.",
		layers: [
			{
				name: "Arcade bass",
				voice: "bass",
				recipes: ["low-minor-pulse", "expressive-contour"]
			},
			{
				name: "Neon fifths",
				voice: "pluck",
				recipes: [
					"a-minor-nocturne",
					"parallel-fifths",
					"upper-octave-sparkle",
					"soft-echo-trail"
				]
			}
		]
	},
	{
		id: "camera/kinetic-choir",
		name: "Camera Kinetic Choir",
		bpm: 76,
		bars: 8,
		input: "camera-gestures",
		description:
			"Camera gestures voice a sustained chord choir with soft descending bell answers.",
		play: "Enable the camera in the input panel and grant camera permission. Move deliberately, then pause to let the two voices decay.",
		layers: [
			{
				name: "Kinetic choir",
				voice: "pad",
				recipes: ["a-minor-nocturne", "smooth-chord-voices", "expressive-contour"]
			},
			{
				name: "Falling answers",
				voice: "bell",
				recipes: ["falling-minor-arp", "soft-echo-trail"]
			}
		]
	},
	{
		id: "microphone/voice-garden",
		name: "Microphone Voice Garden",
		bpm: 82,
		bars: 8,
		input: "microphone-pitch",
		description:
			"Sing a melody into a warm reed with remembered lower notes and a separate slowly opening pad.",
		play: "Enable microphone pitch input, grant permission and use headphones to prevent feedback. Sing clear sustained notes, leaving silence between phrases.",
		layers: [
			{
				name: "Vocal shadow",
				voice: "reed",
				recipes: ["a-minor-nocturne", "two-note-shadow", "expressive-contour"]
			},
			{
				name: "Garden canopy",
				voice: "pad",
				recipes: ["a-minor-nocturne", "open-fifth-bloom"]
			}
		]
	},
	{
		id: "pads/polyrhythm-lab",
		name: "Pads Polyrhythm Lab",
		bpm: 112,
		bars: 16,
		input: "pads",
		groove: "electro",
		description:
			"Repeated pad attacks weave three-against-five figures through changing octaves, with an independent bass response.",
		play: "Tap the pads steadily for at least fifteen attacks to hear the rhythmic strands meet. Start transport for drums; vary your spacing to reshape the echo trail.",
		layers: [
			{
				name: "Three-five lattice",
				voice: "bell",
				recipes: [
					"c-major-sketchbook",
					"three-five-weave",
					"orbiting-pitch-classes",
					"expressive-contour",
					"soft-echo-trail"
				]
			},
			{
				name: "Low response",
				voice: "bass",
				recipes: ["bass-register", "minimal-motion", "two-note-shadow"]
			}
		]
	},
	{
		id: "touch/glass-constellation",
		name: "Touch Glass Constellation",
		bpm: 94,
		bars: 8,
		input: "xy-pitch-controller",
		description:
			"An XY touch instrument scatters bright arpeggios above a gently voice-led pad.",
		play: "Play the XY input with touch or a pointer. Use sparse gestures for glass-like trails; hold a note to hear the pad underneath.",
		layers: [
			{
				name: "Glass stars",
				voice: "bell",
				recipes: ["staccato-arp", "orbiting-pitch-classes", "soft-echo-trail"]
			},
			{
				name: "Constellation pad",
				voice: "pad",
				recipes: ["c-major-sketchbook", "smooth-chord-voices"]
			}
		]
	},
	{
		id: "osc/signal-observatory",
		name: "OSC Signal Observatory",
		bpm: 118,
		bars: 16,
		input: "osc",
		description:
			"Incoming OSC notes split into an interlocking reed motif, low pluck and high echo constellation.",
		play: "Configure and connect the OSC bridge in the input panel. Send notes from your OSC controller; an onscreen keyboard also lets you audition the routing before connecting.",
		layers: [
			{
				name: "Signal weave",
				voice: "reed",
				recipes: ["d-dorian-session", "woven-register", "expressive-contour"]
			},
			{
				name: "Low beacon",
				voice: "bass",
				recipes: ["d-dorian-session", "bass-register", "minimal-motion"]
			},
			{
				name: "Distant reflections",
				voice: "bell",
				recipes: [
					"d-dorian-session",
					"upper-octave-sparkle",
					"two-note-shadow",
					"soft-echo-trail"
				]
			}
		]
	},
	{
		id: "keyboard/midnight-atlas",
		name: "Midnight Atlas",
		bpm: 72,
		bars: 16,
		input: "keyboard",
		description:
			"A long-form three-voice instrument: voice-led minor chords, a remembered bass melody and slowly orbiting high echoes.",
		play: "Play a sparse progression over sixteen bars. Begin with the pad, bring in bass on its surface, then raise the bell layer for a denser second half. Each layer has independent timbre controls.",
		layers: [
			{
				name: "Midnight harmony",
				voice: "pad",
				recipes: ["a-minor-nocturne", "smooth-chord-voices", "expressive-contour"]
			},
			{
				name: "Remembered bass",
				voice: "bass",
				recipes: ["a-minor-nocturne", "two-note-shadow", "bass-register", "minimal-motion"]
			},
			{
				name: "Atlas echoes",
				voice: "bell",
				recipes: [
					"falling-minor-arp",
					"orbiting-pitch-classes",
					"expressive-contour",
					"soft-echo-trail"
				]
			}
		]
	}
]

function recipe(ids: string[]) {
	const seen = new Set<string>()
	return ids
		.flatMap((id) => {
			const preset = catalogue.presets.find((item) => item.id === id)
			if (!preset) {
				throw new Error(`Unknown performance recipe: ${id}`)
			}
			return structuredClone(preset.steps)
		})
		.filter((step) => {
			// Keep the requested key and chord voicing when combining complete recipes.
			if (!["Harmoniser", "Chordifier"].includes(step.type)) {
				return true
			}
			if (seen.has(step.type)) {
				return false
			}
			seen.add(step.type)
			return true
		})
}

function performanceSetup(performance: Performance): PresetSetup {
	const { id, name, description, input, inputOptions, layers } = performance
	const devices: PresetSetup["devices"] = [
		{
			id: "performance-input",
			direction: "input",
			definition: { factory: "input", type: input, options: inputOptions }
		},
		{ id: "keyboard", direction: "input", definition: { factory: "keyboard-input" } }
	]
	const chains = layers.map((layer, index) => {
		const outputId = `voice-${index}`
		devices.push({
			id: outputId,
			direction: "output",
			definition: structuredClone(PRESET_VOICES[layer.voice])
		})
		return {
			id: `layer-${index}`,
			options: { name: layer.name, active: true },
			steps: recipe(layer.recipes),
			inputs: ["performance-input", "keyboard"],
			outputs: [outputId]
		}
	})
	if (performance.groove) {
		devices.push({
			id: "drums",
			direction: "output",
			definition: {
				factory: "output",
				type: "drum-accompaniment",
				options: {
					genre: "electronic",
					groove: performance.groove,
					volume: 0.35,
					density: 0.6,
					energy: 0.65
				}
			}
		})
		chains[0].outputs.push("drums")
	}
	const setup = setupSurfaces({
		id: `performance:${id}`,
		name,
		description: `${description} ${performance.play}`,
		activeChainId: chains[0].id,
		clock: { bpm: performance.bpm, swing: 0, divisions: 24, bars: performance.bars ?? 4 },
		devices,
		chains
	})
	for (const chain of setup.chains) {
		const surface = chain.options.controlSurfaces![0]
		chain.steps.forEach((step, index) => {
			const controls: Record<string, { ids: string[]; widget: "select" | "dial" }> = {
				Harmoniser: { ids: ["root", "mode"], widget: "select" },
				Arpeggiator: { ids: ["pattern", "rate", "octaves"], widget: "select" },
				"Note-Reverb": { ids: ["repeats", "delay", "decay"], widget: "select" },
				"Chord-Bloom": { ids: ["step", "falloff"], widget: "dial" },
				"Rhythm-Weave": { ids: ["cycleA", "cycleB"], widget: "dial" },
				"Register-Orbit": { ids: ["lower", "upper", "stride"], widget: "dial" }
			}
			const control = controls[step.type]
			if (!control) {
				return
			}
			const controlId = `${chain.id}-step-${index}`
			step.config.midiControlId = controlId
			const componentId = `transformer:${controlId}`
			surface.connections.push({ componentId, controlIds: control.ids })
			surface.widgets.push(
				...control.ids.map((id) => ({
					key: JSON.stringify([componentId, id]),
					widget: control.widget
				}))
			)
		})
	}
	return setup
}

const hardwarePages = [
	{ route: "hardware/arcana/strum", page: arcana },
	{ route: "hardware/cosmo/dots", page: cosmo }
]

export const PERFORMANCE_PRESETS: TransformerPreset[] = [
	...PERFORMANCES.map((item) => ({
		id: `performance:${item.id}`,
		name: item.name,
		category: "Performance instruments",
		description: item.description,
		useCase: item.play,
		steps: recipe(item.layers[0].recipes)
	})),
	...hardwarePages.map(({ route, page }) => ({
		id: `performance:${route}`,
		name: page.name,
		category: "Hardware",
		description: page.description,
		useCase:
			"Connect the controller in its input panel, then play. The complete setup includes the controller routing and control surfaces.",
		steps: JSON.parse(page.workspace.chains[0].transformers).map((value: string) => {
			const { type, ...config } = JSON.parse(value)
			return { type, config, summary: `${type} — hardware performance settings.` }
		})
	}))
]

export function performancePreset(preset: Pick<TransformerPreset, "id">) {
	return PERFORMANCES.find((item) => preset.id === `performance:${item.id}`)
}

export function performancePresetSetup(
	preset: Pick<TransformerPreset, "id">
): PresetSetup | undefined {
	const performance = performancePreset(preset)
	if (performance) {
		return performanceSetup(performance)
	}
	const hardware = hardwarePages.find((item) => preset.id === `performance:${item.route}`)
	if (!hardware) {
		return
	}
	const workspace = structuredClone(hardware.page.workspace)
	return {
		...workspace,
		clock: structuredClone(hardware.page.clock),
		id: preset.id,
		name: hardware.page.name,
		description: hardware.page.description,
		chains: workspace.chains.map(({ transformers, ...chain }) => ({
			...chain,
			steps: JSON.parse(transformers).map((value: string) => {
				const { type, ...config } = JSON.parse(value)
				return { type, config, summary: `${type} — hardware performance settings.` }
			})
		}))
	} as PresetSetup
}

export function performanceHardwarePage(id: string) {
	return hardwarePages.find((item) => id === `performance:${item.route}`)?.page
}