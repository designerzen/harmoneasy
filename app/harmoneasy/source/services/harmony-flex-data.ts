import type IOChainManager from "audiobus/io/IO-chain-manager"
import { EVENT_HARMONY_CHANGED } from "audiobus/events/event-constants"
import {
	FlexDataHarmonyAdapter,
	encodeFlexChordNameUmp,
	encodeFlexKeySignatureUmp,
	encodeFlexTempoUmp
} from "audiobus/midi/flex-data"
import {
	getNativeMidiBridge,
	hasNativeMidiBridge,
	type NativeMidiBridge
} from "audiobus/midi/native-midi-bridge"
import { action, element, field, onChange } from "./music-tools-dom"

export function mountFlexDataBridge(
	host: HTMLElement,
	manager: IOChainManager,
	getBpm: () => number,
	setTempo: (bpm: number) => void
) {
	const abort = new AbortController()
	const status = element("p")
	status.setAttribute("role", "status")

	const receive = field(host, "Receive MIDI 2.0 Flex Data harmony", element("input"))
	receive.type = "checkbox"
	const followTempo = field(host, "Follow Flex Data tempo", element("input"))
	followTempo.type = "checkbox"
	const broadcast = field(host, "Broadcast harmony as MIDI 2.0 Flex Data", element("input"))
	broadcast.type = "checkbox"

	let bridge: NativeMidiBridge | undefined
	let unsubscribe: (() => void) | undefined
	const openedInputs = new Set<number>()
	const openedOutputs = new Set<number>()
	let applying = false

	const adapter = new FlexDataHarmonyAdapter({
		coalesceMs: 50,
		initialHarmony: manager.harmony,
		onHarmony: (state, chordName) => {
			if (!receive.checked) {
				return
			}
			try {
				applying = true
				manager.setHarmony(state)
				status.textContent = chordName
					? `Flex Data chord: ${chordName}`
					: "Updated harmony from MIDI 2.0 Flex Data"
			} finally {
				applying = false
			}
		},
		onTempo: (bpm) => {
			if (!receive.checked || !followTempo.checked) {
				return
			}
			if (Number.isFinite(bpm) && bpm >= 10 && bpm <= 303) {
				setTempo(Math.round(bpm * 100) / 100)
			}
		}
	})

	async function ensureBridge(): Promise<NativeMidiBridge> {
		if (!hasNativeMidiBridge()) {
			throw new Error("MIDI 2.0 Flex Data requires the Electron desktop app")
		}
		return (bridge ??= getNativeMidiBridge())
	}

	async function startReceiving() {
		const native = await ensureBridge()
		const inputs = await native.getUmpInputs()
		unsubscribe ??= native.onUmpInput((_index, words) => {
			adapter.feed(words)
		})
		for (const device of inputs) {
			if (!openedInputs.has(device.index)) {
				await native.openUmpInput(device.index)
				openedInputs.add(device.index)
			}
		}
		status.textContent = inputs.length
			? `Listening for MIDI 2.0 Flex Data on ${inputs.length} port(s)`
			: "No MIDI 2.0 UMP input ports found"
	}

	async function stopReceiving() {
		unsubscribe?.()
		unsubscribe = undefined
		if (bridge) {
			for (const index of [...openedInputs]) {
				await bridge.closeUmpInput(index).catch(() => {})
			}
		}
		openedInputs.clear()
	}

	async function sendHarmonyNow() {
		if (applying) {
			return
		}
		const native = await ensureBridge()
		const outputs = await native.getUmpOutputs()
		const packets = [
			encodeFlexTempoUmp(getBpm()),
			encodeFlexKeySignatureUmp(manager.harmony),
			encodeFlexChordNameUmp(manager.harmony)
		]
		for (const device of outputs) {
			if (!openedOutputs.has(device.index)) {
				await native.openUmpOutput(device.index)
				openedOutputs.add(device.index)
			}
			for (const packet of packets) {
				await native.sendUmp(device.index, packet)
			}
		}
		status.textContent = outputs.length
			? `Sent Flex Data harmony to ${outputs.length} port(s)`
			: "No MIDI 2.0 UMP output ports found"
	}

	async function stopBroadcasting() {
		if (bridge) {
			for (const index of [...openedOutputs]) {
				await bridge.closeUmpOutput(index).catch(() => {})
			}
		}
		openedOutputs.clear()
	}

	onChange(receive, () => {
		const task = receive.checked ? startReceiving() : stopReceiving()
		void task.catch((error) => {
			receive.checked = false
			status.textContent = String(error instanceof Error ? error.message : error)
		})
	})

	onChange(broadcast, () => {
		const task = broadcast.checked ? sendHarmonyNow() : stopBroadcasting()
		void task.catch((error) => {
			broadcast.checked = false
			status.textContent = String(error instanceof Error ? error.message : error)
		})
	})

	host.append(
		element(
			"p",
			"Exchange live chord symbols, key signatures, and tempo over MIDI 2.0 Flex Data (UMP type 0xD) using the Electron native MIDI 2.0 bridge."
		),
		action(
			"Send current chord as Flex Data",
			() => {
				void sendHarmonyNow().catch((error) => {
					status.textContent = String(error instanceof Error ? error.message : error)
				})
			},
			status
		),
		status
	)

	manager.addEventListener(
		EVENT_HARMONY_CHANGED,
		() => {
			if (broadcast.checked && !applying) {
				void sendHarmonyNow().catch((error) => {
					status.textContent = String(error instanceof Error ? error.message : error)
				})
			}
		},
		{ signal: abort.signal }
	)

	return {
		destroy() {
			abort.abort()
			adapter.destroy()
			void stopReceiving()
			void stopBroadcasting()
		}
	}
}
