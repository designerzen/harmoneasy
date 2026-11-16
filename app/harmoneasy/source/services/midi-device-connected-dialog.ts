import type IOChain from "audiobus/io/IO-chain"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { MidiDeviceArrival } from "audiobus/hardware/midi-devices/known-midi-inputs"
import { MIDI_DEVICE_PROFILES } from "audiobus/hardware/midi-devices/device-profiles"
import { EVENT_CHANGE } from "audiobus/events/event-constants"
import { deviceIcon, elementIcon } from "../components/graph/element-icons"
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
	const selections: HTMLInputElement[] = []
	const dialog = createDialogFromTemplate("midi-device-connected-template", [
		{ id: "midi-device-ignore", label: "Ignore for now", onClick: () => {} },
		{
			id: "midi-device-add",
			label: "Add to selected chains",
			onClick: () => {
				chosen = chains.filter(
					(chain, index) => selections[index].checked && !chain.isDestroyed
				)
			}
		}
	])
	const icon = (src: string) => {
		const image = document.createElement("img")
		image.src = src
		image.alt = ""
		return image
	}
	const profile = device.profileId ? MIDI_DEVICE_PROFILES[device.profileId] : undefined
	dialog
		.querySelector(".midi-connected-icon")!
		.append(icon(profile?.icon || elementIcon("input", "webmidi")))
	dialog.querySelector(".midi-connected-name")!.textContent = device.name || "Unnamed MIDI device"
	const list = dialog.querySelector(".midi-chain-list")!
	const add = dialog.querySelector<HTMLButtonElement>("#midi-device-add")!
	add.classList.add("primary")
	const all = dialog.querySelector<HTMLInputElement>(".midi-chain-all input")!
	dialog.querySelector<HTMLElement>(".midi-chain-all")!.hidden = chains.length < 2
	const status = dialog.querySelector(".midi-chain-status")!
	const update = () => {
		const count = selections.filter((input) => input.checked).length
		add.disabled = count === 0
		add.textContent = count
			? `Add to ${count} ${count === 1 ? "chain" : "chains"}`
			: "Select a chain"
		status.textContent = `${count} of ${chains.length} selected`
		all.checked = count === chains.length
		all.indeterminate = count > 0 && count < chains.length
	}
	chains.forEach((chain, index) => {
		const row = document.createElement("label")
		row.className = "midi-chain-option"
		const input = document.createElement("input")
		input.type = "checkbox"
		input.checked = chains.length === 1
		input.id = `midi-device-chain-${index}`
		selections.push(input)
		const text = document.createElement("span")
		const name = document.createElement("strong")
		name.textContent = chainName(chain, index)
		const description = document.createElement("small")
		description.textContent = [
			chain.inputs.map((input) => input.name).join(" + ") || "No inputs",
			...chain.transformers.map((transformer) => transformer.name),
			chain.outputs.map((output) => output.name).join(" + ") ||
				"No output — add one to hear notes"
		].join(" → ")
		text.append(name, description)
		row.append(
			input,
			icon(
				chain.outputs[0]
					? deviceIcon(chain.outputs[0], "output")
					: elementIcon("output", "")
			),
			text
		)
		list.append(row)
		input.addEventListener(EVENT_CHANGE, update)
	})
	all.addEventListener(EVENT_CHANGE, () => {
		selections.forEach((input) => {
			input.checked = all.checked
		})
		update()
	})
	update()
	await showDialog(dialog)
	return chosen
}