import {
	EVENT_CLICK,
	EVENT_CLOSE,
	EVENT_ERROR,
	EVENT_CHAINS_UPDATED,
	EVENT_RECORDER_TOGGLE,
	EVENT_RECORDER_REVIEW
} from "audiobus/event-constants"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import OutputRecorder from "audiobus/io/outputs/output-recorder"
import { AudioRecording } from "./audio-recording"
import { RECORDING_STATE_CHANGED, type RecordingBits } from "./recording-format"

export function createRecordingControls(
	context: AudioContext,
	source: AudioNode,
	root: Document = document,
	manager?: IOChainManager
) {
	const recording = new AudioRecording(context, source)
	const recorders = new Set<OutputRecorder>()
	const button = root.querySelector<HTMLButtonElement>("#btn-record")!
	const review = root.querySelector<HTMLButtonElement>("#btn-recording-review")!
	const clock = root.querySelector<HTMLElement>("#clock")!
	const dialog = root.querySelector<HTMLDialogElement>("#recording-dialog")!
	const audio = root.querySelector<HTMLAudioElement>("#recording-playback")!
	const filename = root.querySelector<HTMLInputElement>("#recording-filename")!
	const format = root.querySelector<HTMLSelectElement>("#recording-format")!
	const save = root.querySelector<HTMLButtonElement>("#recording-save")!
	const status = root.querySelector<HTMLElement>("#recording-status")!
	const details = root.querySelector<HTMLElement>("#recording-details")!
	let url: string | undefined
	let busy = false
	let reviewing = false

	const duration = () => {
		const seconds = Math.floor(recording.duration)
		return `${Math.floor(seconds / 3600)
			.toString()
			.padStart(2, "0")}:${Math.floor((seconds / 60) % 60)
			.toString()
			.padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
	}
	const clearPlayback = () => {
		audio.pause()
		audio.removeAttribute("src")
		audio.load()
		if (url) {
			URL.revokeObjectURL(url)
		}
		url = undefined
	}
	const render = () => {
		const active = recording.state === "recording"
		button.hidden = !!manager && recorders.size === 0
		review.hidden = true
		button.disabled = busy || recording.state === "starting" || recording.state === "stopping"
		button.classList.toggle("is-recording", active)
		button.setAttribute("aria-pressed", String(active))
		button.textContent = active
			? "Stop recording"
			: recording.state === "stopping"
				? "Finishing…"
				: "Record"
		button.title = active
			? "Stop all Recorder outputs and review take"
			: "Start all Recorder outputs; replaces the previous take"
		review.disabled = busy || recording.state !== "idle" || !recording.hasTake
		clock.classList.toggle("is-recording", active)
		clock.setAttribute(
			"aria-label",
			active ? "Transport time; recording audio" : "Transport time"
		)
		root.body.classList.toggle("is-recording", active)
		for (const recorder of recorders) {
			recorder.setRecordingState(active, button.disabled, recording.hasTake)
		}
		save.disabled = busy || recording.state !== "idle" || !recording.hasTake
		format.disabled = busy
		filename.disabled = busy
		details.textContent = `${duration()} · ${recording.sampleRate.toLocaleString()} Hz · Stereo · ${recording.storage === "opfs" ? "Saved in browser storage" : "Memory only (64 MB limit)"}`
	}
	const show = async () => {
		if (busy || reviewing) {
			return
		}
		reviewing = true
		busy = true
		clearPlayback()
		status.textContent = recording.error || "Preparing playback…"
		dialog.hidden = false
		render()
		if (!dialog.open) {
			dialog.showModal()
		}
		const initialFocus = root.activeElement
		try {
			if (recording.hasTake) {
				const blob = await recording.wave(16)
				url = URL.createObjectURL(blob)
				audio.src = url
				audio.load()
			}
			status.textContent =
				recording.error ||
				"The next recording replaces this take. Export a copy to keep it."
		} catch (error) {
			status.textContent = `Playback could not be prepared: ${error instanceof Error ? error.message : error}. The source take is retained.`
		} finally {
			busy = false
			reviewing = false
			render()
			if (dialog.open && !save.disabled && root.activeElement === initialFocus) {
				save.focus({ preventScroll: true })
			}
		}
	}

	recording.addEventListener(RECORDING_STATE_CHANGED, () => {
		render()
		if (manager && !recorders.size && recording.state === "recording") {
			void recording.stop()
		}
		if (recording.state === "idle" && recording.error) {
			status.textContent = recording.error
			button.title = recording.error
		}
	})
	let wasRecording = false
	recording.addEventListener(RECORDING_STATE_CHANGED, () => {
		if (wasRecording && recording.state === "idle") {
			wasRecording = false
			void show()
		}
		if (recording.state === "recording") {
			wasRecording = true
		}
	})
	const toggle = async () => {
		if (
			busy ||
			(manager && !recorders.size) ||
			recording.state === "starting" ||
			recording.state === "stopping"
		) {
			return
		}
		if (recording.state === "recording") {
			await recording.stop()
			return
		}
		clearPlayback()
		dialog.close()
		await recording.start()
	}
	const toggleRecorder = () => {
		void toggle()
	}
	const reviewRecorder = () => {
		void show()
	}
	button.addEventListener(EVENT_CLICK, toggleRecorder)
	review.addEventListener(EVENT_CLICK, () => {
		void show()
	})
	root.querySelector("#recording-close")!.addEventListener(EVENT_CLICK, () => dialog.close())
	dialog.addEventListener(EVENT_CLOSE, () => audio.pause())
	audio.addEventListener(EVENT_ERROR, () => {
		if (audio.getAttribute("src")) {
			status.textContent =
				"This browser cannot preview this WAV file. You can still save the recording."
		}
	})
	save.addEventListener(EVENT_CLICK, async () => {
		if (busy || !recording.hasTake) {
			return
		}
		busy = true
		render()
		const bits = Number(format.value) as RecordingBits
		const name =
			(filename.value
				.trim()
				.replace(/\.wav$/i, "")
				// oxlint-disable-next-line no-control-regex -- Strip control characters forbidden in filenames.
				.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
				.slice(0, 120) || "Harmoneasy recording") + ".wav"
		try {
			// Acquire the destination during the click gesture, before conversion.
			const picker = (window as any).showSaveFilePicker
			const handle = picker
				? ((await picker.call(window, {
						suggestedName: name,
						types: [{ description: "WAV audio", accept: { "audio/wav": [".wav"] } }]
					})) as FileSystemFileHandle)
				: undefined
			status.textContent = "Preparing audio for saving…"
			const blob = await recording.wave(bits)
			if (handle) {
				const output = await handle.createWritable()
				await blob.stream().pipeTo(output)
				status.textContent = "Recording saved. The take is still available here."
			} else {
				const download = URL.createObjectURL(blob)
				const anchor = root.createElement("a")
				anchor.href = download
				anchor.download = name
				root.body.append(anchor)
				anchor.click()
				anchor.remove()
				setTimeout(() => URL.revokeObjectURL(download), 60_000)
				status.textContent = "Download started. The take is still available here."
			}
		} catch (error) {
			status.textContent =
				error instanceof DOMException && error.name === "AbortError"
					? "Save cancelled. Your take is still available."
					: `Could not save: ${error instanceof Error ? error.message : error}. Your take is retained.`
		} finally {
			busy = false
			render()
		}
	})
	button.disabled = true
	const syncRecorders = () => {
		const next = new Set(
			manager?.chains.flatMap((chain) =>
				chain.outputs.filter((output) => output instanceof OutputRecorder)
			) as OutputRecorder[]
		)
		let added = false
		for (const recorder of recorders) {
			if (!next.has(recorder)) {
				recorder.removeEventListener(EVENT_RECORDER_TOGGLE, toggleRecorder)
				recorder.removeEventListener(EVENT_RECORDER_REVIEW, reviewRecorder)
				recorders.delete(recorder)
			}
		}
		for (const recorder of next) {
			if (!recorders.has(recorder)) {
				recorders.add(recorder)
				recorder.addEventListener(EVENT_RECORDER_TOGGLE, toggleRecorder)
				recorder.addEventListener(EVENT_RECORDER_REVIEW, reviewRecorder)
				added = true
			}
		}
		render()
		if (added) {
			void recording.ready.then(async () => {
				if (recorders.size && recording.state === "idle") {
					await toggle()
				}
			})
		}
		if (!recorders.size && recording.state === "recording") {
			void recording.stop()
		}
	}
	manager?.addEventListener(EVENT_CHAINS_UPDATED, syncRecorders)
	if (manager) {
		syncRecorders()
	}
	void recording.ready.then(() => {
		render()
	})
	return recording
}