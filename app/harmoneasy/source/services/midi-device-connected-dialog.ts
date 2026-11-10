import type IOChain from "audiobus/io/IO-chain"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { MidiDeviceArrival } from "audiobus/midi/hardware/known-midi-inputs"
import { createDialogFromTemplate, showDialog } from "../libs/dialog-utils"

const chainName = (chain: IOChain, index: number) => chain.options.name ?? `Chain ${index + 1}`

// Ask which chains a hot-plugged MIDI device should join. Closing the dialog
// or choosing Ignore resolves with no chains.
export async function chooseChainsForMidiDevice(
	manager: IOChainManager,
	device: MidiDeviceArrival
): Promise<IOChain[]> {
	const chains = manager.chains.filter((chain) => !chain.isDestroyed)
	if (!chains.length) {
		return []
	}
	let chosen: IOChain[] = []
	const options = chains.map((chain, index) => ({
		id: `midi-device-chain-${index}`,
		label: `Add to ${chainName(chain, index)}`,
		onClick: () => {
			chosen = [chain]
		}
	}))
	if (chains.length > 1) {
		options.push({
			id: "midi-device-chain-all",
			label: "Add to all chains",
			onClick: () => {
				chosen = chains
			}
		})
	}
	options.push({
		id: "midi-device-ignore",
		label: "Ignore",
		onClick: () => {
			chosen = []
		}
	})
	const dialog = createDialogFromTemplate("midi-device-connected-template", options)
	dialog.querySelector(".midi-device-connected-message")!.textContent =
		`“${device.name}” was connected. Choose a chain to add it to, or ignore it until it is next plugged in.`
	await showDialog(dialog)
	return chosen
}
