import type IOChainManager from "audiobus/io/IO-chain-manager"
import { ClockSourceController, clockMidiPorts, type ClockSource } from "./clock-source"

export function createClockSourceControls(
	timer: ConstructorParameters<typeof ClockSourceController>[0],
	manager: IOChainManager,
	link: ConstructorParameters<typeof ClockSourceController>[2],
	persist: (source: ClockSource, device: string) => void,
	playingChanged: () => void
) {
	const select = document.getElementById("clock-source") as HTMLSelectElement
	const device = document.getElementById("clock-midi-device") as HTMLSelectElement
	const deviceLabel = document.getElementById("clock-midi-label")!
	const tick = document.getElementById("btn-clock-tick") as HTMLButtonElement
	const status = document.getElementById("clock-source-status")!
	let ready = false
	const error = (value: unknown) => {
		status.textContent = value instanceof Error ? value.message : String(value)
	}
	const render = (source: ClockSource, selectedDevice: string) => {
		const ports = clockMidiPorts(manager)
		let midi = select.querySelector<HTMLOptionElement>('option[value="midi"]')
		if (ports.length && !midi) {
			midi = document.createElement("option")
			midi.value = "midi"
			midi.textContent = "MIDI transport / clock"
			select.insertBefore(midi, select.querySelector('option[value="manual"]'))
		}
		if (!ports.length && midi) {
			if (source === "midi") {
				midi.disabled = true
				midi.textContent = "MIDI transport / clock (disconnected)"
			} else {
				midi.remove()
			}
		} else if (midi) {
			midi.disabled = false
			midi.textContent = "MIDI transport / clock"
		}
		select.value = source
		device.replaceChildren(
			...ports.map((port) => {
				const option = document.createElement("option")
				option.value = port.id
				option.textContent = port.name
				return option
			})
		)
		const available = ports.some((port) => port.id === selectedDevice)
		if (selectedDevice && !available) {
			const unavailable = document.createElement("option")
			unavailable.value = selectedDevice
			unavailable.textContent = `${selectedDevice} (disconnected)`
			unavailable.disabled = true
			device.append(unavailable)
		}
		device.value = selectedDevice
		deviceLabel.hidden = source !== "midi"
		tick.hidden = source !== "manual"
		for (const id of [
			"tempo",
			"swing",
			"btn-tempo-up",
			"btn-tempo-down",
			"timer-type-select"
		]) {
			const control = document.getElementById(id) as
				| HTMLInputElement
				| HTMLSelectElement
				| null
			if (control) {
				control.disabled = source !== "internal"
			}
		}
		for (const id of ["btn-transport-start", "btn-transport-stop", "btn-transport-reset"]) {
			const control = document.getElementById(id) as HTMLButtonElement | null
			if (control) {
				control.disabled = source === "shared" || source === "midi"
			}
		}
		status.textContent =
			source === "midi"
				? available
					? "Waiting for MIDI transport and clock ticks."
					: "MIDI clock disconnected; transport stopped."
				: source === "manual"
					? "One tick per press; 24 ticks per beat."
					: source === "shared"
						? "Following the host. Open Shared room to join or leave."
						: ""
		if (ready) {
			persist(source, selectedDevice)
			playingChanged()
		}
	}
	const controller = new ClockSourceController(timer, manager, link, render, error)
	ready = true
	select.disabled = false
	select.addEventListener("change", async () => {
		const source = select.value as ClockSource
		select.disabled = true
		try {
			await controller.setSource(source)
		} catch (value) {
			render(controller.source, controller.midiDevice)
			error(value)
		} finally {
			select.disabled = false
		}
	})
	device.addEventListener("change", () => {
		void controller.setMidiDevice(device.value).catch(error)
	})
	tick.addEventListener("click", () => {
		void controller.manualTick().catch(error)
	})
	const keydown = (event: KeyboardEvent) => {
		if (
			controller.source !== "manual" ||
			event.code !== "Space" ||
			event.repeat ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey
		) {
			return
		}
		const target = event.target
		if (
			target instanceof Element &&
			target.closest(
				'input, textarea, select, button, [contenteditable]:not([contenteditable="false"])'
			)
		) {
			return
		}
		event.preventDefault()
		event.stopImmediatePropagation()
		void controller.manualTick().catch(error)
	}
	window.addEventListener("keydown", keydown, { capture: true })
	window.addEventListener(
		"pagehide",
		() => {
			window.removeEventListener("keydown", keydown, { capture: true })
			controller.destroy()
		},
		{ once: true }
	)
	return controller
}