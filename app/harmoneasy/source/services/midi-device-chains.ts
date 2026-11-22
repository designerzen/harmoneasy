import type IOChain from "audiobus/io/IO-chain"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { MidiChainLink, MidiPortSummary } from "./midi-devices-dialog"

const chainName = (chain: IOChain, index: number) => chain.options.name ?? `Chain ${index + 1}`

// The port a MIDI node is bound to: an ID, null when it takes every port, or
// undefined when it is not a MIDI port node (or an output still on its default).
function boundPort(node: any, type: MidiPortSummary["type"]): string | null | undefined {
	if (node.options?.deviceId) {
		return String(node.options.deviceId)
	}
	const source = node.midiInput ?? node
	const devices = type === "input" ? source.inputDevices : source.outputDevices
	if (!Array.isArray(devices)) {
		return
	}
	const options = source.options ?? {}
	if (
		options.listenToAllDevices === true ||
		options.sendToAllDevices === true ||
		options.selectedDevice === ""
	) {
		return null
	}
	if (options.selectedDevice != null) {
		return String(options.selectedDevice)
	}
	return type === "input" ? null : undefined
}

const nodes = (chain: IOChain, type: MidiPortSummary["type"]): any[] =>
	type === "input" ? chain.inputs : chain.outputs

// Wire a MIDI port into chains the same way hot-plug discovery does: a
// profiled device becomes its profile's input, anything else a WebMIDI port,
// and one logical device is shared by every chain it joins.
export function createMidiDeviceChains(manager: IOChainManager) {
	const shared = (port: MidiPortSummary) =>
		manager.devices.find(
			(entry) =>
				entry.direction === port.type && boundPort(entry.device, port.type) === port.id
		)?.device
	const create = async (port: MidiPortSummary, profileId?: string) => {
		if (port.type === "input") {
			const { createInputById } = await import("audiobus/io/input-factory")
			return createInputById(profileId ?? "webmidi", {
				...manager.deviceOptions,
				autoManagedMidi: true,
				transport: "webmidi",
				deviceId: port.id,
				selectedDevice: port.id,
				listenToAllDevices: false,
				deviceName: port.name
			})
		}
		const { createOutputById } = await import("audiobus/io/output-factory")
		return createOutputById("webmidi", {
			...manager.deviceOptions,
			selectedDevice: port.id,
			sendToAllDevices: false,
			deviceName: port.name
		})
	}
	return (port: MidiPortSummary, profileId?: string): MidiChainLink[] =>
		manager.chains
			.filter((chain) => !chain.isDestroyed)
			.map((chain, index) => {
				const bound = nodes(chain, port.type).map((node) => boundPort(node, port.type))
				const state = bound.includes(port.id)
					? "linked"
					: port.type === "input" && bound.includes(null)
						? "all"
						: "none"
				return {
					name: chainName(chain, index),
					state,
					toggle: async () => {
						if (state === "linked") {
							for (const node of nodes(chain, port.type)) {
								if (boundPort(node, port.type) === port.id) {
									if (port.type === "input") {
										chain.removeInput(node)
									} else {
										chain.removeOutput(node)
									}
								}
							}
							return
						}
						if (state === "all") {
							return
						}
						const existing = shared(port)
						const device = existing ?? (await create(port, profileId))
						manager.addDevice(chain, device, port.type)
						if (!existing) {
							await device.connect?.()
						}
					}
				}
			})
}
