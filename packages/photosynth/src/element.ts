import { PhotosynthController } from "./controller.js"
import type { PhotosynthOptions } from "./controller.js"
import {
	PHOTOSYNTH_EMOJI,
	PHOTOSYNTH_ERROR,
	PHOTOSYNTH_FRAME,
	PHOTOSYNTH_MUSIC,
	PHOTOSYNTH_OVERLAY_ERROR,
	PHOTOSYNTH_STATE
} from "./events.js"
import { EmojiDetector } from "./emoji.js"
import type { EmojiState } from "./emoji.js"
import { WebGPUFaceOverlay } from "./webgpu-overlay.js"
import { EMOJI_FONT_FAMILY, loadEmojiFont } from "./emoji-font.js"
import { containedVideoRect, faceEmojiPlacement } from "./overlay-layout.js"
import { PhotosynthMusic } from "./music.js"
import type { MusicOptions } from "./music.js"
import type { FacePrediction, MusicMessage, PhotosynthFrame, PhotosynthState } from "./types.js"

const STYLE = `
:host{display:block;color:#f2f5fa;font:15px/1.5 system-ui,sans-serif;--accent:#b9f270;color-scheme:dark}
*{box-sizing:border-box}article{background:#141b23;border:1px solid #3c4854;border-radius:20px;padding:clamp(16px,4vw,28px);max-width:850px;margin:auto}
header,.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}h2{margin:0;font-size:1.6rem}p{color:#b9c6d4;margin:8px 0 18px}.badge{color:var(--accent);font-size:.8rem;letter-spacing:.12em;text-transform:uppercase}
.stage{position:relative;width:100%;aspect-ratio:4/3;max-height:400px;overflow:hidden;border-radius:12px;background:#080d12;margin:18px 0}
video,canvas{position:absolute;width:100%;height:100%;object-fit:contain}video{transform:scaleX(-1)}.placeholder{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:#a9b7c6;padding:24px;pointer-events:none}
.controls,.meters{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:16px;margin:20px 0}label{display:grid;gap:6px;color:#d1dce8}select,button,input{font:inherit}select,button{border:1px solid #526171;border-radius:8px;padding:9px 12px;background:#202c39;color:inherit;min-height:44px}button{cursor:pointer}button.primary{background:var(--accent);color:#142007;border-color:transparent;font-weight:700}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}input[type=range]{width:100%;accent-color:var(--accent)}output{font-variant-numeric:tabular-nums}meter{display:block;width:100%;height:14px;accent-color:var(--accent)}.meter-label{display:flex;justify-content:space-between;gap:8px}.status{min-height:1.5em;margin:12px 0 0;color:#d1dce8}.note{font-size:1.4rem;font-weight:700;color:var(--accent)}small{display:block;color:#a9b7c6} [hidden]{display:none!important}
`
const OVERLAY_STYLE = `.stage canvas{pointer-events:none}.emoji-fallback{position:absolute;pointer-events:none;line-height:1;text-align:center;transform-origin:center;font-family:"${EMOJI_FONT_FAMILY}",sans-serif}.expression{display:block;margin:8px 0;font-weight:600;font-family:"${EMOJI_FONT_FAMILY}",system-ui,sans-serif}.renderer-status{margin:8px 0}.overlay-options{display:flex;align-items:center;gap:8px}.overlay-options input{width:20px;height:20px;accent-color:var(--accent)}`
const METERS = [
	"happiness",
	"sadness",
	"anger",
	"fear",
	"surprise",
	"disgust",
	"neutral",
	"mouthRatio"
] as const
const MUSIC_CONTROLS = [
	"scale",
	"root",
	"octaveLow",
	"octaveHigh",
	"threshold",
	"smoothing",
	"precision",
	"headNoteRangeDegrees",
	"headVerticalRangeDegrees",
	"noteController",
	"octaveController"
] as const

/** Import photosynth/element to register <photosynth-controller>. Camera starts only on user action. */
export class PhotosynthElement extends HTMLElement {
	private controller: PhotosynthController
	private music = new PhotosynthMusic()
	private session = 0
	private subscriptions?: AbortController
	private root: ShadowRoot
	private emojiDetector = new EmojiDetector()
	private emoji: EmojiState | null = null
	private face: FacePrediction | null = null
	private overlay?: WebGPUFaceOverlay
	private overlayGeneration = 0
	private resizeObserver?: ResizeObserver

	constructor() {
		super()
		this.root = this.attachShadow({ mode: "open" })
		this.controller = this.createController()
		this.root.innerHTML = `<style>${STYLE}${OVERLAY_STYLE}</style><article aria-label="Photosynth expression controller">
<header><div><span class="badge">Expression input</span><h2>Photosynth</h2></div><output class="note" aria-label="Current note">—</output></header>
<p>Open your mouth or smile to send notes. Head movement selects notes and octaves; eyebrows bend pitch. Connect an output to hear sound.</p>
<div class="toolbar"><label>Camera<select id="camera"><option value="">Default camera</option></select></label><button class="primary" id="start" type="button">Start camera</button><button id="stop" type="button" disabled>Stop</button></div>
<div class="stage"><video aria-label="Mirrored camera preview" muted playsinline></video><canvas aria-hidden="true" width="640" height="480"></canvas><span class="emoji-fallback" aria-hidden="true" hidden></span><div class="placeholder">Your camera preview will appear here.<br>Camera access starts when you press Start.</div></div>
<output class="expression" aria-label="Detected expression">No face in view</output><label class="overlay-options"><input id="show-dots" type="checkbox" checked disabled>Show landmark dots</label><small class="renderer-status" role="status">Preparing WebGPU overlay…</small>
<div class="controls"><label>Scale<select id="scale"><option value="pentatonic">Pentatonic</option><option value="major">Major</option><option value="minor">Minor</option></select></label>
<label>Root<select id="root">${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"].map((note, i) => `<option value="${i}">${note}</option>`).join("")}</select></label>
${(["octaveLow", "octaveHigh"] as const).map((id) => `<label>${id === "octaveLow" ? "Lower" : "Upper"} octave<select id="${id}">${Array.from({ length: 9 }, (_, value) => `<option>${value}</option>`).join("")}</select></label>`).join("")}
<label>Gate threshold <output id="threshold-value">18%</output><input id="threshold" type="range" min="1" max="100" value="18"></label>
<label>Smoothing <output id="smoothing-value">35%</output><input id="smoothing" type="range" min="0" max="95" value="35"></label>
<label>Expression precision<select id="precision">${Array.from({ length: 7 }, (_, value) => `<option value="${value}">${value} decimal places</option>`).join("")}</select></label>
${(["headNoteRangeDegrees", "headVerticalRangeDegrees"] as const).map((id) => `<label>${id === "headNoteRangeDegrees" ? "Head tilt range" : "Head vertical range"} <output id="${id}-value">90°</output><input id="${id}" type="range" min="20" max="120" step="1" value="90"></label>`).join("")}
${(["noteController", "octaveController"] as const).map((id) => `<label>${id === "noteController" ? "Note" : "Octave"} axis<select id="${id}"><option value="roll">Head tilt (roll)</option><option value="pitch">Head nod (pitch)</option><option value="yaw">Head turn (yaw)</option></select></label>`).join("")}
</div><small>Angle ranges are the total sweep, split equally around centre. Precision rounds the mouth/smile signal before smoothing and MIDI conversion.</small>
<div class="meters">${METERS.map((key) => `<label><span class="meter-label">${key === "mouthRatio" ? "Mouth opening" : key[0]!.toUpperCase() + key.slice(1)}<output data-value="${key}">0%</output></span><meter data-meter="${key}" min="0" max="1" value="0"></meter></label>`).join("")}</div>
<p class="status" role="status" aria-live="polite">Ready. Choose a camera, then press Start.</p>
<small>Video is processed on your device. The MediaPipe model and runtime are downloaded on first use. Expression meters describe visible facial actions.</small></article>`
		this.root
			.querySelectorAll("output")
			.forEach((output) => output.setAttribute("aria-live", "off"))
		this.syncSettings()
	}

	private query<T extends Element>(selector: string): T {
		return this.root.querySelector<T>(selector)!
	}
	private createController(options: PhotosynthOptions = {}) {
		const controller = new PhotosynthController(options)
		controller.addEventListener(PHOTOSYNTH_FRAME, (event) =>
			this.onFrame((event as CustomEvent<PhotosynthFrame>).detail)
		)
		controller.addEventListener(PHOTOSYNTH_STATE, (event) => {
			this.updateState((event as CustomEvent<PhotosynthState>).detail)
			this.forward(PHOTOSYNTH_STATE, (event as CustomEvent).detail)
		})
		controller.addEventListener(PHOTOSYNTH_ERROR, (event) =>
			this.reportError((event as CustomEvent<Error>).detail)
		)
		return controller
	}
	/** Configure asset hosting or detector before starting the camera. */
	set cameraOptions(options: PhotosynthOptions) {
		this.stop()
		this.controller = this.createController(options)
		this.query<HTMLVideoElement>("video").style.transform =
			options.mirrored === false ? "none" : "scaleX(-1)"
	}
	get musicOptions(): Readonly<MusicOptions> {
		return this.music.options
	}
	set musicOptions(options: Partial<MusicOptions>) {
		this.send(this.music.configure(options))
		this.syncSettings()
	}
	private syncSettings() {
		const settings = this.music.options
		for (const id of MUSIC_CONTROLS) {
			const value = settings[id]
			this.query<HTMLInputElement | HTMLSelectElement>(`#${id}`).value = String(
				id === "threshold" || id === "smoothing" ? Number(value) * 100 : value
			)
		}
		this.updateRangeLabels()
	}

	connectedCallback() {
		this.subscriptions?.abort()
		this.subscriptions = new AbortController()
		const signal = this.subscriptions.signal
		this.query("#start").addEventListener(
			"click",
			() => {
				void this.start().catch(() => {})
			},
			{ signal }
		)
		this.query("#stop").addEventListener("click", () => this.stop(), { signal })
		this.query("#show-dots").addEventListener("change", () => this.renderOverlay(), { signal })
		for (const id of MUSIC_CONTROLS) {
			this.query(`#${id}`).addEventListener(
				"input",
				() => {
					const raw = this.query<HTMLInputElement | HTMLSelectElement>(`#${id}`).value
					const value = ["scale", "noteController", "octaveController"].includes(id)
						? raw
						: Number(raw) / (id === "threshold" || id === "smoothing" ? 100 : 1)
					const options: Partial<MusicOptions> = { [id]: value }
					// Keep both octave limits valid while moving either control.
					if (id === "octaveLow" && Number(value) > this.music.options.octaveHigh) {
						options.octaveHigh = Number(value)
					}
					if (id === "octaveHigh" && Number(value) < this.music.options.octaveLow) {
						options.octaveLow = Number(value)
					}
					this.musicOptions = options
				},
				{ signal }
			)
		}
		document.addEventListener(
			"visibilitychange",
			() => {
				if (document.hidden) {
					this.stop()
				}
			},
			{ signal }
		)
		navigator.mediaDevices?.addEventListener(
			"devicechange",
			() => {
				void this.loadCameras()
			},
			{ signal }
		)
		void this.loadCameras()
		// Also load the bundled face when WebGPU is unavailable and the DOM emoji is used.
		void loadEmojiFont().catch(() => {})
		this.resizeObserver = new ResizeObserver(() => this.renderOverlay())
		this.resizeObserver.observe(this.query(".stage"))
		void this.initializeOverlay()
	}
	disconnectedCallback() {
		this.subscriptions?.abort()
		this.subscriptions = undefined
		this.stop()
		++this.overlayGeneration
		this.resizeObserver?.disconnect()
		this.resizeObserver = undefined
		this.overlay?.destroy()
		this.overlay = undefined
	}

	async start(): Promise<void> {
		if (!this.isConnected) {
			throw new Error("Connect the Photosynth element before starting.")
		}
		const session = ++this.session
		try {
			await this.controller.start(
				this.query<HTMLVideoElement>("video"),
				this.query<HTMLSelectElement>("#camera").value || undefined
			)
			if (session !== this.session) {
				return
			}
			if (this.controller.state === "running") {
				await this.loadCameras()
			}
		} catch (cause) {
			if (session === this.session && this.controller.state !== "error") {
				this.reportError(cause instanceof Error ? cause : new Error(String(cause)))
			}
			throw cause
		}
	}
	stop() {
		++this.session
		this.controller.stop()
		this.send(this.music.reset())
	}

	private async loadCameras() {
		if (!navigator.mediaDevices?.enumerateDevices) {
			return
		}
		try {
			const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
				(device) => device.kind === "videoinput"
			)
			const select = this.query<HTMLSelectElement>("#camera"),
				selected = select.value
			const option = (label: string, value: string) => {
				const element = document.createElement("option")
				element.textContent = label
				element.value = value
				return element
			}
			select.replaceChildren(option("Default camera", ""))
			cameras.forEach((camera, index) =>
				select.add(option(camera.label || `Camera ${index + 1}`, camera.deviceId))
			)
			if (cameras.some((camera) => camera.deviceId === selected)) {
				select.value = selected
			}
		} catch {
			/* Starting the camera reports actionable permission errors. */
		}
	}
	private updateState(state: PhotosynthState) {
		const busy = state === "loading" || state === "running"
		this.query<HTMLButtonElement>("#start").disabled = busy
		this.query<HTMLButtonElement>("#stop").disabled = !busy
		this.query<HTMLSelectElement>("#camera").disabled = busy
		this.query<HTMLElement>(".placeholder").hidden = state === "running"
		this.query(".status").textContent =
			state === "loading"
				? "Opening camera and loading MediaPipe…"
				: state === "running"
					? "Camera ready. Move into view to play."
					: "Camera stopped. Press Start to play."
	}
	private reportError(error: Error) {
		this.query(".status").textContent =
			error.name === "NotAllowedError"
				? "Camera permission was denied. Allow camera access in your browser, then try again."
				: error.message
		this.forward(PHOTOSYNTH_ERROR, error)
	}
	private updateRangeLabels() {
		for (const id of ["threshold", "smoothing"]) {
			this.query(`#${id}-value`).textContent =
				`${this.query<HTMLInputElement>(`#${id}`).value}%`
		}
		for (const id of ["headNoteRangeDegrees", "headVerticalRangeDegrees"]) {
			this.query(`#${id}-value`).textContent =
				`${this.query<HTMLInputElement>(`#${id}`).value}°`
		}
	}
	private forward(type: string, detail: unknown) {
		this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
	}
	private onFrame(frame: PhotosynthFrame) {
		const face = frame.face
		for (const key of METERS) {
			const value = face?.[key] ?? 0
			this.query<HTMLMeterElement>(`[data-meter="${key}"]`).value = value
			this.query(`[data-value="${key}"]`).textContent = `${Math.round(value * 100)}%`
		}
		this.face = face
		const previous = this.emoji
		this.emoji = this.emojiDetector.detect(face)
		this.query(".expression").textContent = this.emoji
			? `${this.emoji.glyph} ${this.emoji.label}`
			: "No face in view"
		if (
			previous?.expression !== this.emoji?.expression ||
			previous?.mirrored !== this.emoji?.mirrored
		) {
			this.forward(PHOTOSYNTH_EMOJI, this.emoji)
		}
		this.renderOverlay()
		if (this.controller.state === "running") {
			const status = face
				? "Tracking. Open your mouth or smile to play."
				: "No face in view. Face the camera in good light."
			if (this.query(".status").textContent !== status) {
				this.query(".status").textContent = status
			}
		}
		this.send(this.music.update(face))
		this.forward(PHOTOSYNTH_FRAME, frame)
	}

	private async initializeOverlay() {
		const generation = ++this.overlayGeneration
		try {
			const overlay = await WebGPUFaceOverlay.create(this.query("canvas"), (error) => {
				if (generation === this.overlayGeneration) {
					this.overlayFailed(error)
				}
			})
			if (generation !== this.overlayGeneration || !this.isConnected) {
				overlay.destroy()
				return
			}
			this.overlay?.destroy()
			this.overlay = overlay
			this.query<HTMLInputElement>("#show-dots").disabled = false
			this.query(".renderer-status").textContent =
				"WebGPU: emoji and landmark overlay active."
			this.renderOverlay()
		} catch (cause) {
			if (generation === this.overlayGeneration && this.isConnected) {
				this.overlayFailed(cause instanceof Error ? cause : new Error(String(cause)))
			}
		}
	}
	private overlayFailed(error: Error) {
		this.overlay?.destroy()
		this.overlay = undefined
		this.query<HTMLInputElement>("#show-dots").disabled = true
		this.query(".renderer-status").textContent =
			`${error.message} Showing emoji without landmark dots.`
		this.forward(PHOTOSYNTH_OVERLAY_ERROR, error)
		this.renderOverlay()
	}
	private renderOverlay() {
		const video = this.query<HTMLVideoElement>("video")
		if (this.overlay) {
			try {
				this.overlay.render(
					this.face,
					this.emoji,
					video.videoWidth,
					video.videoHeight,
					this.query<HTMLInputElement>("#show-dots").checked
				)
			} catch (cause) {
				this.overlayFailed(cause instanceof Error ? cause : new Error(String(cause)))
				return
			}
		}
		const fallback = this.query<HTMLElement>(".emoji-fallback")
		fallback.hidden = Boolean(this.overlay) || !this.face || !this.emoji
		if (!fallback.hidden && this.face && this.emoji) {
			const stage = this.query<HTMLElement>(".stage")
			const placement = faceEmojiPlacement(
				this.face,
				containedVideoRect(
					stage.clientWidth,
					stage.clientHeight,
					video.videoWidth || 640,
					video.videoHeight || 480
				)
			)
			fallback.hidden = !placement
			if (placement) {
				fallback.textContent = this.emoji.glyph
				fallback.style.left = `${placement.x}px`
				fallback.style.top = `${placement.y}px`
				fallback.style.fontSize = `${placement.size * 0.8}px`
				fallback.style.transform = `translate(-50%, -50%) rotate(${placement.rotation}rad) scaleX(${this.emoji.mirrored ? -1 : 1})`
			}
		}
	}

	private send(messages: MusicMessage[]) {
		for (const message of messages) {
			if (message.type === "noteon") {
				this.query(".note").textContent =
					`${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][message.note % 12]}${Math.floor(message.note / 12) - 1}`
			} else if (message.type === "noteoff") {
				this.query(".note").textContent = "—"
			}
			this.forward(PHOTOSYNTH_MUSIC, message)
		}
	}
}

export function definePhotosynthElement(registry: CustomElementRegistry = customElements): void {
	if (!registry.get("photosynth-controller")) {
		registry.define("photosynth-controller", PhotosynthElement)
	}
}
if (typeof customElements !== "undefined") {
	definePhotosynthElement()
}

declare global {
	interface HTMLElementTagNameMap {
		"photosynth-controller": PhotosynthElement
	}
}
