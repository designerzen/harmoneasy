import type IOChainManager from "audiobus/io/IO-chain-manager"
import { ClockSourceController, clockDvsInputs, clockMidiPorts, type ClockSource } from "./clock-source"

export function createClockSourceControls(
	timer: ConstructorParameters<typeof ClockSourceController>[0],
	manager: IOChainManager,
	link: ConstructorParameters<typeof ClockSourceController>[2],
	persist: (source: ClockSource, device: string) => void,
	playingChanged: () => void,
	followMicrophone: (enabled: boolean) => Promise<void> = async () => {},
	persistReferenceBPM: (bpm: number) => void = () => {}
) {
	const select = document.getElementById("clock-source") as HTMLSelectElement
	const device = document.getElementById("clock-midi-device") as HTMLSelectElement
	const deviceLabel = document.getElementById("clock-midi-label")!
	const dvsLabel = document.getElementById("clock-dvs-label")!
	const dvsBpm = document.getElementById("clock-dvs-bpm") as HTMLInputElement
	const tick = document.getElementById("btn-clock-tick") as HTMLButtonElement
	const status = document.getElementById("clock-source-status")!
	let ready = false
	let microphone = false
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
		const dvsConnected = clockDvsInputs(manager).length > 0
		let dvs = select.querySelector<HTMLOptionElement>('option[value="dvs"]')
		if (dvsConnected && !dvs) {
			dvs = document.createElement("option")
			dvs.value = "dvs"
			dvs.textContent = "DVS control vinyl"
			select.insertBefore(dvs, select.querySelector('option[value="manual"]'))
		}
		if (!dvsConnected && dvs) {
			if (source === "dvs") {
				dvs.disabled = true
				dvs.textContent = "DVS control vinyl (disconnected)"
			} else {
				dvs.remove()
			}
		} else if (dvs) {
			dvs.disabled = false
			dvs.textContent = "DVS control vinyl"
		}
		if (source !== "internal" && microphone) {
			microphone = false
			void followMicrophone(false).catch(error)
		}
		select.value = microphone ? "microphone" : source
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
		dvsLabel.hidden = source !== "dvs"
		// render() first runs inside the controller constructor, before `ready`
		if (ready && document.activeElement !== dvsBpm) {
			dvsBpm.value = String(controller.dvsReferenceBPM)
		}
		tick.hidden = source !== "manual" && source !== "dvs"
		tick.textContent = source === "dvs" ? "Downbeat" : "Tick"
		tick.title =
			source === "dvs"
				? "Make the next platter tick the first beat of bar 1"
				: "Advance one clock tick (24 ticks per beat); keyboard shortcut: Space"
		for (const id of [
			"tempo",
			"swing",
			"btn-tempo-up",
			"btn-tempo-down",
			"btn-swing-up",
			"btn-swing-down",
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
				control.disabled = source === "shared" || source === "midi" || source === "dvs"
			}
		}
		status.textContent =
			source === "midi"
				? available
					? "Waiting for MIDI transport and clock ticks."
					: "MIDI clock disconnected; transport stopped."
				: source === "dvs"
					? dvsConnected
						? "Waiting for the control vinyl signal; the platter starts and stops transport."
						: "DVS input disconnected; transport stopped."
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
		const requestedMicrophone = select.value === "microphone"
		const source = requestedMicrophone ? "internal" : (select.value as ClockSource)
		select.disabled = true
		try {
			microphone = false
			await followMicrophone(false)
			await controller.setSource(source)
			await followMicrophone(requestedMicrophone)
			microphone = requestedMicrophone && controller.source === "internal"
			if (requestedMicrophone && !microphone) {
				await followMicrophone(false)
			}
			render(controller.source, controller.midiDevice)
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
	dvsBpm.addEventListener("change", () => {
		try {
			controller.setDvsReferenceBPM(Number(dvsBpm.value))
			persistReferenceBPM(controller.dvsReferenceBPM)
		} catch (value) {
			error(value)
		}
		dvsBpm.value = String(controller.dvsReferenceBPM)
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
