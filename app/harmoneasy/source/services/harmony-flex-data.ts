import type IOChainManager from "audiobus/io/IO-chain-manager"
import { EVENT_HARMONY_CHANGED, EVENT_HARMONY_SETTINGS_CHANGED, EVENT_MUSICAL_TIMING_CHANGED, EVENT_WORKSPACE_RESTORED } from "audiobus/events/event-constants"
import { FlexDataHarmonyAdapter, encodeFlexChordNameUmp, encodeFlexKeySignatureUmp, encodeFlexTempoUmp, encodeFlexTimeSignatureUmp, encodeFlexMetronomeUmp } from "audiobus/midi/flex-data"
import { getNativeMidiBridge, hasNativeMidiBridge, type NativeMidiBridge, type NativeMidiDevice } from "audiobus/midi/native-midi-bridge"
import { action, element, field, numberField, onChange, selectField } from "./music-tools-dom"

const FLEX_SOURCE = "midi2:flex"

export function mountFlexDataBridge(host: HTMLElement, manager: IOChainManager, getBpm: () => number, setTempo: (bpm: number) => void) {
	const abort = new AbortController()
	const status = element("p")
	status.setAttribute("role", "status")
	const input = selectField(host, "Flex Data input", [{ name: "Choose an input", value: "" }])
	const output = selectField(host, "Flex Data output", [{ name: "Choose an output", value: "" }])
	const group = numberField(host, "UMP group (1–16)", 1, 1, 16)
	const channel = selectField(host, "Harmony address", [{ name: "Whole group", value: "0" }, ...Array.from({ length: 16 }, (_, i) => ({ name: `Channel ${i + 1} and group`, value: String(i + 1) }))])
	const coalesce = numberField(host, "Merge untimed changes (ms)", 0, 0, 100, 1)
	const receive = field(host, "Receive MIDI 2.0 Flex Data harmony", element("input"))
	receive.type = "checkbox"
	const followTempo = field(host, "Follow Flex Data tempo", element("input"))
	followTempo.type = "checkbox"
	const followTiming = field(host, "Follow Flex Data time signature and metronome", element("input"))
	followTiming.type = "checkbox"
	const broadcast = field(host, "Broadcast harmony as MIDI 2.0 Flex Data", element("input"))
	broadcast.type = "checkbox"
	let bridge: NativeMidiBridge | undefined
	let adapter: FlexDataHarmonyAdapter | undefined
	let unsubscribe: (() => void) | undefined
	let openedInput: number | undefined
	let openedOutput: number | undefined
	let alive = true
	let ownsHarmony = false
	let applying = false
	let generation = 0
	let queue: Promise<void> = Promise.resolve()
	const echoes = new Map<string, number>()
	function run(task: () => Promise<void>) {
		queue = queue.then(task).catch(error => { if (alive) {status.textContent = error instanceof Error ? error.message : String(error)} })
		return queue
	}
	async function ensureBridge(): Promise<NativeMidiBridge> {
		if (!hasNativeMidiBridge()) {throw new Error("MIDI 2.0 Flex Data requires the Electron desktop app")}
		const native = bridge ??= getNativeMidiBridge()
		if (!(await native.getCapabilities()).umpSupport) {throw new Error("The selected MIDI backend cannot carry Flex Data UMP packets")}
		return native
	}
	function fill(select: HTMLSelectElement, ports: NativeMidiDevice[]) {
		const previous = select.value
		select.replaceChildren()
		for (const port of ports) {
			const option = element("option", port.name)
			option.value = String(port.index)
			select.append(option)
		}
		if (ports.some(p => String(p.index) === previous)) {select.value = previous}
		else if (previous !== "") {select.selectedIndex = -1}
	}
	async function refreshPorts() {
		const native = await ensureBridge()
		const [inputs, outputs] = await Promise.all([native.getUmpInputs(), native.getUmpOutputs()])
		if (!alive) {return}
		fill(input, inputs)
		fill(output, outputs)
	}
	function stopFollowing() {
		generation++
		receive.checked = false
		unsubscribe?.()
		unsubscribe = undefined
		adapter?.destroy()
		adapter = undefined
		if (ownsHarmony) {manager.externallyControlledHarmony = false}
		ownsHarmony = false
	}
	async function closeInput() {
		const index = openedInput
		openedInput = undefined
		if (index !== undefined) {await bridge?.closeUmpInput(index)}
	}
	async function closeOutput() {
		const index = openedOutput
		openedOutput = undefined
		if (index !== undefined) {await bridge?.closeUmpOutput(index)}
	}
	function withIncoming(run: () => void) {
		applying = true
		try { run() } finally { applying = false }
	}
	async function startReceiving(version: number) {
		try {
			await closeInput()
			const native = await ensureBridge()
			if (input.value === "") {await refreshPorts()}
			if (!alive || version !== generation || !receive.checked) {return}
			if (input.value === "") {throw new Error("Choose a connected Flex Data input")}
			if (manager.externallyControlledHarmony && !ownsHarmony) {throw new Error("Release the other harmony source before following Flex Data")}
			const index = Number(input.value)
			await native.openUmpInput(index)
			openedInput = index
			if (!alive || version !== generation || !receive.checked) { await closeInput(); return }
			manager.externallyControlledHarmony = ownsHarmony = true
			adapter = new FlexDataHarmonyAdapter({
				coalesceMs: Number(coalesce.value), initialHarmony: manager.harmony,
				group: Number(group.value) - 1, channel: Number(channel.value) || undefined,
				onHarmony: (state, name) => withIncoming(() => {
					manager.setHarmony(state, FLEX_SOURCE)
					status.textContent = name ? `Flex Data chord: ${name}` : "Updated shared key from Flex Data"
				}),
				onTempo: bpm => { if (followTempo.checked && bpm >= 10 && bpm <= 303) {withIncoming(() => setTempo(bpm))} },
				onTimeSignature: timeSignature => { if (followTiming.checked) {withIncoming(() => manager.setMusicalTiming({ ...manager.musicalTiming, timeSignature }, FLEX_SOURCE))} },
				onMetronome: metronome => { if (followTiming.checked) {withIncoming(() => manager.setMusicalTiming({ ...manager.musicalTiming, metronome }, FLEX_SOURCE))} }
			})
			unsubscribe = native.onUmpInput((source, words) => {
				if (!receive.checked || source !== openedInput) {return}
				if ((echoes.get(words.join(",")) ?? 0) > performance.now()) {return}
				adapter?.feed(words)
			})
			status.textContent = `Following ${input.selectedOptions[0]?.textContent}, group ${group.value}`
		} catch (error) {
			if (version === generation) {stopFollowing()}
			await closeInput()
			throw error
		}
	}
	function restartReceiving() {
		const enabled = receive.checked
		stopFollowing()
		receive.checked = enabled
		const version = generation
		void run(() => enabled ? startReceiving(version) : closeInput())
	}
	async function sendHarmonyNow() {
		if (!alive || applying) {return}
		const native = await ensureBridge()
		if (output.value === "") {await refreshPorts()}
		if (!alive) {return}
		if (output.value === "") {throw new Error("Choose a connected Flex Data output")}
		const index = Number(output.value)
		if (openedOutput !== index) {
			await closeOutput()
			await native.openUmpOutput(index)
			openedOutput = index
		}
		if (!alive) { await closeOutput(); return }
		const address = { group: Number(group.value) - 1, groupScoped: channel.value === "0", channel: Number(channel.value) }
		const timing = manager.musicalTiming
		const packets = [encodeFlexTempoUmp(getBpm(), address), encodeFlexKeySignatureUmp(manager.harmony, address)]
		if (timing.timeSignature) {packets.push(encodeFlexTimeSignatureUmp(timing.timeSignature, address))}
		if (timing.metronome) {packets.push(encodeFlexMetronomeUmp(timing.metronome, address))}
		packets.push(encodeFlexChordNameUmp(manager.harmony, address))
		for (const [key, expiry] of echoes) {if (expiry <= performance.now()) {echoes.delete(key)}}
		for (const packet of packets) {
			echoes.set(packet.join(","), performance.now() + 1000)
			await native.sendUmp(index, packet)
		}
		if (!broadcast.checked) {await closeOutput()}
		if (alive) {status.textContent = `Sent Flex Data to ${output.selectedOptions[0]?.textContent}`}
	}
	onChange(receive, restartReceiving)
	for (const control of [input, group, channel, coalesce]) {onChange(control, () => { if (receive.checked) {restartReceiving()} })}
	onChange(output, () => { void run(closeOutput) })
	onChange(broadcast, () => { void run(broadcast.checked ? sendHarmonyNow : closeOutput) })
	host.append(
		element("p", "Share key and chord independently over native MIDI 2.0 UMP. Local harmony edits take control back. Tempo does not set transport position; select an external clock separately."),
		action("Refresh MIDI 2.0 ports", () => run(async () => {
			stopFollowing()
			await closeInput()
			await closeOutput()
			await refreshPorts()
			status.textContent = "Ports refreshed. Choose a source and enable receiving."
		}), status),
		action("Send current chord as Flex Data", () => run(sendHarmonyNow), status),
		action("Use local harmony", () => { stopFollowing(); void run(closeInput); status.textContent = "Local harmony controls are active" }, status),
		status
	)
	const changed = (event: Event) => {
		if (applying || (event as CustomEvent).detail?.source === FLEX_SOURCE) {return}
		if (receive.checked) { stopFollowing(); void run(closeInput) }
		if (broadcast.checked) {void run(sendHarmonyNow)}
	}
	for (const event of [EVENT_HARMONY_CHANGED, EVENT_HARMONY_SETTINGS_CHANGED, EVENT_WORKSPACE_RESTORED, EVENT_MUSICAL_TIMING_CHANGED]) {manager.addEventListener(event, changed, { signal: abort.signal })}
	return { destroy() {
		alive = false
		abort.abort()
		stopFollowing()
		void run(async () => { await closeInput(); await closeOutput() })
	} }
}
