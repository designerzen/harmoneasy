import type { PresetSetup, PresetStep } from "audiobus/io/preset-library"
import type { DeviceDefinition } from "audiobus/io/device-definition"
import type { SurfaceState } from "control-surface/types"

export const PRESET_VOICES: Record<string, DeviceDefinition> = {
	pluck: {
		factory: "polyphonic",
		options: {
			shape: "triangle",
			volume: 0.4,
			attack: 0.003,
			decay: 0.25,
			sustain: 0.12,
			release: 0.2,
			filterCutOff: 4200
		}
	},
	pad: {
		factory: "polyphonic",
		options: {
			shape: "triangle",
			volume: 0.25,
			attack: 0.8,
			decay: 1.2,
			sustain: 0.65,
			release: 3,
			filterCutOff: 1100
		}
	},
	bass: {
		factory: "polyphonic",
		options: {
			shape: "sawtooth",
			volume: 0.3,
			attack: 0.005,
			decay: 0.15,
			sustain: 0.35,
			release: 0.08,
			filterCutOff: 650,
			filterResonance: 2
		}
	},
	bell: {
		factory: "polyphonic",
		options: {
			shape: "sine",
			volume: 0.35,
			attack: 0.002,
			decay: 0.8,
			sustain: 0.05,
			release: 1.4,
			filterCutOff: 6500
		}
	},
	reed: {
		factory: "polyphonic",
		options: {
			shape: "square",
			volume: 0.22,
			attack: 0.04,
			decay: 0.2,
			sustain: 0.45,
			release: 0.18,
			filterCutOff: 1700
		}
	}
}

export function presetVoice(steps: PresetStep[]): DeviceDefinition {
	const types = steps.map((step) => step.type)
	const voice = steps.some(
		(step) => step.type === "Transposer" && Number(step.config.distance) <= -12
	)
		? "bass"
		: types.includes("Chord-Bloom") || types.includes("Voice-Leader")
			? "pad"
			: types.includes("Arpeggiator") || types.includes("Note-Reverb")
				? "bell"
				: types.includes("Chordifier") || types.includes("Strummer")
					? "pluck"
					: "reed"
	return structuredClone(PRESET_VOICES[voice])
}

/** Bind only controls supplied by these device factories; external plugins keep their own UI. */
export function setupSurfaces(setup: PresetSetup): PresetSetup {
	for (const chain of setup.chains) {
		if (chain.options.controlSurfaces?.length) {
			continue
		}
		const connections = setup.devices
			.filter((device) => chain.outputs.includes(device.id))
			.flatMap((device) => {
				const controls =
					device.definition.factory === "polyphonic"
						? [
								"volume",
								"shape",
								"attack",
								"release",
								"filterCutOff",
								"filterResonance"
							]
						: device.definition.type === "drum-accompaniment"
							? ["volume", "groove", "energy", "density"]
							: []
				return controls.length ? [{ componentId: device.id, controlIds: controls }] : []
			})
		if (!connections.length) {
			continue
		}
		const surface: SurfaceState = {
			id: `${chain.id}-performance`,
			name: `${chain.options.name} controls`,
			theme: "ice",
			connections,
			widgets: connections.flatMap(({ componentId, controlIds }) =>
				controlIds.map((id) => ({
					key: JSON.stringify([componentId, id]),
					widget:
						id === "shape" || id === "groove"
							? undefined
							: id === "volume"
								? ("slider" as const)
								: ("dial" as const)
				}))
			)
		}
		chain.options.controlSurfaces = [surface]
		chain.options.mainSurfaceId = surface.id
	}
	return setup
}