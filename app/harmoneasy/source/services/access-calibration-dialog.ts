import {
	EVENT_CHANGE,
	EVENT_CLICK,
	EVENT_CLOSE,
	EVENT_INPUT,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_LEAVE,
	EVENT_POINTER_UP
} from "audiobus/events/event-constants"
import {
	buildAccessProfileUrl,
	calibrateDwellTiming,
	calibrateMicThreshold,
	calibrateTapTiming,
	DEFAULT_ACCESS_PROFILE,
	type AccessProfile,
	type TapSample
} from "./access-profile"
import type { AccessibilityController } from "./accessibility"
import { buildSeatPresetUrl, CLASSROOM_ROLES, type ClassroomRole } from "./classroom-session"
import { EVENT_POINTER_OUT, EVENT_POINTER_OVER } from "./dwell-controller"
import type { FocusStageMode, FocusStagePadCount } from "./focus-stage"
import type { AuditoryCueMode, SwitchReleaseMode, SwitchScanMode } from "./switch-scanner"

export interface CalibrationDialogOptions {
	doc: Document
	accessibility: AccessibilityController
	getStageConfig?: () => Partial<AccessProfile>
	getLocation?: () => string
	baseUrl?: string
	onApply: (profile: AccessProfile, sensoryPreset: "none" | "low-vision" | "deaf-tactile") => void
}

/**
 * Non-React guided calibration dialog that measures tap cadence/bounce,
 * dwell hold comfort, or mic clap threshold and generates a bookmarkable
 * `/parts/v1/` learner or classroom seat link.
 */
export function createCalibrationDialog({
	doc,
	accessibility,
	getStageConfig,
	getLocation = () => doc.defaultView?.location.href ?? "https://harmoneasy.app/",
	baseUrl = "/",
	onApply
}: CalibrationDialogOptions) {
	const abort = new AbortController()
	let profile: AccessProfile = { ...DEFAULT_ACCESS_PROFILE }
	let sensoryPreset: "none" | "low-vision" | "deaf-tactile" = "none"
	let roomId = ""
	let seatRole: ClassroomRole | "" = ""
	let tapSamples: TapSample[] = []
	let activeTapDownMs: number | null = null
	let dwellSamples: number[] = []
	let dwellEnterMs: number | null = null

	const dialog = doc.createElement("dialog")
	dialog.id = "access-calibration-dialog"
	dialog.className = "access-calibration"
	dialog.setAttribute("aria-labelledby", "access-calibration-title")
	dialog.setAttribute("data-midi-ignore", "")

	dialog.innerHTML = `
		<header class="cal-header">
			<h2 id="access-calibration-title">Guided Access Calibration &amp; Learner Profile</h2>
			<button type="button" class="tertiary close-icon" id="cal-close" aria-label="Close calibration"></button>
		</header>
		<div class="cal-body">
			<p class="cal-intro">Measure comfortable tap, switch, dwell, or clap timing once, then bookmark or share a single link that reopens this exact setup on any browser.</p>

			<section class="cal-card" aria-labelledby="cal-step-tap">
				<h3 id="cal-step-tap">1. Tap &amp; Switch Timing Calibration</h3>
				<p>Tap the big pad (or press <kbd>Space</kbd>) 3 to 5 times at your comfortable pace. Bounce lockout, tremor filtering, and scan speed adjust automatically.</p>
				<div class="cal-pad-row">
					<button type="button" id="cal-tap-pad" class="cal-big-pad">Tap or press Space (0 / 4)</button>
					<button type="button" id="cal-tap-reset" class="secondary">Reset taps</button>
				</div>
				<p id="cal-tap-result" class="cal-result" role="status" aria-live="polite">Waiting for taps…</p>
			</section>

			<section class="cal-card" aria-labelledby="cal-step-dwell">
				<h3 id="cal-step-dwell">2. Dwell Hover &amp; Microphone Clap (Optional)</h3>
				<div class="cal-pad-row">
					<button type="button" id="cal-dwell-pad" class="cal-dwell-pad">Hover here as long as feels natural, then move away</button>
					<label for="cal-mic-threshold">Mic clap threshold
						<input id="cal-mic-threshold" type="range" min="0.04" max="0.75" step="0.01" value="0.15" />
						<output id="cal-mic-value" for="cal-mic-threshold">Off</output>
					</label>
					<button type="button" id="cal-mic-enable" class="secondary">Include Mic Clap</button>
				</div>
				<p id="cal-dwell-result" class="cal-result" role="status"></p>
			</section>

			<section class="cal-card" aria-labelledby="cal-step-profile">
				<h3 id="cal-step-profile">3. Learner Profile &amp; Portable Link</h3>
				<div class="cal-grid">
					<label for="cal-label">Profile name
						<input id="cal-label" type="text" maxlength="80" placeholder="e.g. Maya — 1-switch chords" />
					</label>
					<label for="cal-sensory">Sensory preset
						<select id="cal-sensory">
							<option value="none">Standard audio</option>
							<option value="low-vision">Low-vision + Speech</option>
							<option value="deaf-tactile">Deaf + Haptics &amp; Notation</option>
						</select>
					</label>
					<label for="cal-stage-mode">Focus Stage mode
						<select id="cal-stage-mode">
							<option value="scale">Scale pads</option>
							<option value="chords">Chord pads</option>
							<option value="step">1-button step</option>
						</select>
					</label>
					<label for="cal-pad-count">Pads
						<select id="cal-pad-count">
							<option value="1">1</option>
							<option value="4">4</option>
							<option value="8" selected>8</option>
						</select>
					</label>
					<label for="cal-scan-mode">Switch scanning
						<select id="cal-scan-mode">
							<option value="off">Off</option>
							<option value="auto-1-switch">1-switch auto-scan</option>
							<option value="step-2-switch">2-switch step/select</option>
						</select>
					</label>
					<label for="cal-scan-ms">Scan tempo
						<select id="cal-scan-ms">
							<option value="1500">Slow (1.5s)</option>
							<option value="1000" selected>Medium (1.0s)</option>
							<option value="600">Fast (0.6s)</option>
						</select>
					</label>
					<label for="cal-release-mode">Note release
						<select id="cal-release-mode">
							<option value="timed">Timed release</option>
							<option value="latch">Latch toggle</option>
						</select>
					</label>
					<label for="cal-cue">Scan auditory cue
						<select id="cal-cue">
							<option value="off">Off</option>
							<option value="speech">Speech readout</option>
							<option value="tone">Soft private chime</option>
						</select>
					</label>
					<label for="cal-dwell-ms">Pointer dwell
						<select id="cal-dwell-ms">
							<option value="0">Off</option>
							<option value="400">0.4s</option>
							<option value="600">0.6s</option>
							<option value="900">0.9s</option>
							<option value="1200">1.2s</option>
						</select>
					</label>
					<label for="cal-room-id">Classroom room ID (optional)
						<input id="cal-room-id" type="text" placeholder="Leave blank for solo link" />
					</label>
					<label for="cal-role">Classroom seat role (optional)
						<select id="cal-role">
							<option value="">Solo / general profile</option>
							${CLASSROOM_ROLES.map((r) => `<option value="${r.id}">${r.label}</option>`).join("")}
						</select>
					</label>
					<label class="cal-checkbox" for="cal-open-stage">
						<input id="cal-open-stage" type="checkbox" checked />
						Open Focus Stage automatically on link launch
					</label>
				</div>

				<div class="cal-link-box">
					<label for="cal-url">Bookmarkable learner link (<code>/parts/v1/</code>)</label>
					<div class="cal-link-row">
						<input id="cal-url" type="url" readonly />
						<button type="button" id="cal-copy-url" class="secondary">Copy learner link</button>
					</div>
					<p id="cal-status" class="cal-result" role="status" aria-live="polite"></p>
				</div>
			</section>
		</div>
		<footer class="cal-footer">
			<button type="button" id="cal-cancel" class="secondary">Close</button>
			<button type="button" id="cal-apply" class="primary">Apply profile now</button>
		</footer>
	`
	doc.body.append(dialog)

	const tapPad = dialog.querySelector<HTMLButtonElement>("#cal-tap-pad")!
	const tapReset = dialog.querySelector<HTMLButtonElement>("#cal-tap-reset")!
	const tapResult = dialog.querySelector<HTMLElement>("#cal-tap-result")!
	const dwellPad = dialog.querySelector<HTMLButtonElement>("#cal-dwell-pad")!
	const dwellResult = dialog.querySelector<HTMLElement>("#cal-dwell-result")!
	const micSlider = dialog.querySelector<HTMLInputElement>("#cal-mic-threshold")!
	const micValue = dialog.querySelector<HTMLOutputElement>("#cal-mic-value")!
	const micEnable = dialog.querySelector<HTMLButtonElement>("#cal-mic-enable")!
	const labelInput = dialog.querySelector<HTMLInputElement>("#cal-label")!
	const sensorySelect = dialog.querySelector<HTMLSelectElement>("#cal-sensory")!
	const stageModeSelect = dialog.querySelector<HTMLSelectElement>("#cal-stage-mode")!
	const padCountSelect = dialog.querySelector<HTMLSelectElement>("#cal-pad-count")!
	const scanModeSelect = dialog.querySelector<HTMLSelectElement>("#cal-scan-mode")!
	const scanMsSelect = dialog.querySelector<HTMLSelectElement>("#cal-scan-ms")!
	const releaseModeSelect = dialog.querySelector<HTMLSelectElement>("#cal-release-mode")!
	const cueSelect = dialog.querySelector<HTMLSelectElement>("#cal-cue")!
	const dwellMsSelect = dialog.querySelector<HTMLSelectElement>("#cal-dwell-ms")!
	const roomInput = dialog.querySelector<HTMLInputElement>("#cal-room-id")!
	const roleSelect = dialog.querySelector<HTMLSelectElement>("#cal-role")!
	const openStageCheck = dialog.querySelector<HTMLInputElement>("#cal-open-stage")!
	const urlInput = dialog.querySelector<HTMLInputElement>("#cal-url")!
	const copyBtn = dialog.querySelector<HTMLButtonElement>("#cal-copy-url")!
	const statusEl = dialog.querySelector<HTMLElement>("#cal-status")!
	const applyBtn = dialog.querySelector<HTMLButtonElement>("#cal-apply")!
	const closeBtn = dialog.querySelector<HTMLButtonElement>("#cal-close")!
	const cancelBtn = dialog.querySelector<HTMLButtonElement>("#cal-cancel")!

	const buildCurrentUrl = (): string => {
		const normalizedRoom = roomId
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^[^a-z0-9]+|-+$/g, "")
			.slice(0, 64)
		if (seatRole) {
			return buildSeatPresetUrl({
				location: getLocation(),
				base: baseUrl,
				roomId: normalizedRoom || undefined,
				role: seatRole,
				seatName: profile.label,
				accessProfile: profile
			})
		}
		return buildAccessProfileUrl({
			location: getLocation(),
			base: baseUrl,
			profile,
			roomId: normalizedRoom || undefined,
			sensoryPreset
		})
	}

	const syncFields = () => {
		labelInput.value = profile.label ?? ""
		sensorySelect.value = sensoryPreset
		stageModeSelect.value = profile.stageMode
		padCountSelect.value = String(profile.padCount)
		scanModeSelect.value = profile.scanMode
		scanMsSelect.value = String(profile.scanMs)
		releaseModeSelect.value = profile.releaseMode
		cueSelect.value = profile.auditoryCue
		dwellMsSelect.value = String(profile.dwellMs)
		openStageCheck.checked = profile.openFocusStage
		if (profile.micThreshold !== undefined) {
			micSlider.value = String(profile.micThreshold)
			micValue.textContent = profile.micThreshold.toFixed(2)
			micEnable.textContent = "Remove Mic Clap"
		} else {
			micValue.textContent = "Off"
			micEnable.textContent = "Include Mic Clap"
		}
		urlInput.value = buildCurrentUrl()
	}

	const recordTapEnd = () => {
		if (activeTapDownMs === null) {
			return
		}
		const upMs = Date.now()
		tapSamples.push({ downMs: activeTapDownMs, upMs })
		activeTapDownMs = null
		tapPad.textContent = `Tap or press Space (${tapSamples.length} / 4)`
		if (tapSamples.length >= 2) {
			const result = calibrateTapTiming(tapSamples)
			profile = {
				...profile,
				stabilizerEnabled: result.stabilizerEnabled,
				debounceMs: result.debounceMs,
				holdThresholdMs: result.holdThresholdMs,
				minDurationMs: result.minDurationMs,
				scanMs: result.scanMs
			}
			tapResult.textContent = result.summary
			syncFields()
		} else {
			tapResult.textContent = "1 tap recorded — tap at least 2 more times."
		}
	}

	tapPad.addEventListener(
		EVENT_POINTER_DOWN,
		(event) => {
			event.preventDefault()
			activeTapDownMs = Date.now()
		},
		{ signal: abort.signal }
	)
	tapPad.addEventListener(EVENT_POINTER_UP, recordTapEnd, { signal: abort.signal })
	tapPad.addEventListener(EVENT_POINTER_LEAVE, recordTapEnd, { signal: abort.signal })
	tapPad.addEventListener(
		EVENT_KEY_DOWN,
		(event) => {
			if (!event.repeat && (event.code === "Space" || event.key === "Enter")) {
				event.preventDefault()
				activeTapDownMs = Date.now()
			}
		},
		{ signal: abort.signal }
	)
	tapPad.addEventListener(
		EVENT_KEY_UP,
		(event) => {
			if (event.code === "Space" || event.key === "Enter") {
				event.preventDefault()
				recordTapEnd()
			}
		},
		{ signal: abort.signal }
	)

	tapReset.addEventListener(
		EVENT_CLICK,
		() => {
			tapSamples = []
			activeTapDownMs = null
			tapPad.textContent = "Tap or press Space (0 / 4)"
			tapResult.textContent = "Calibration cleared — tap 3 to 5 times to measure again."
		},
		{ signal: abort.signal }
	)

	dwellPad.addEventListener(
		EVENT_POINTER_OVER,
		() => {
			dwellEnterMs = Date.now()
		},
		{ signal: abort.signal }
	)
	dwellPad.addEventListener(
		EVENT_POINTER_OUT,
		() => {
			if (dwellEnterMs === null) {
				return
			}
			const held = Date.now() - dwellEnterMs
			dwellEnterMs = null
			if (held > 120) {
				dwellSamples.push(held)
				const result = calibrateDwellTiming(dwellSamples)
				profile = { ...profile, dwellMs: result.dwellMs }
				dwellResult.textContent = result.summary
				syncFields()
			}
		},
		{ signal: abort.signal }
	)

	micEnable.addEventListener(
		EVENT_CLICK,
		() => {
			if (profile.micThreshold !== undefined) {
				delete profile.micThreshold
				dwellResult.textContent = "Microphone clap trigger excluded from link."
			} else {
				const calibrated = calibrateMicThreshold(0.03, Number(micSlider.value) * 2)
				profile = { ...profile, micThreshold: calibrated.micThreshold }
				dwellResult.textContent = calibrated.summary
			}
			syncFields()
		},
		{ signal: abort.signal }
	)

	micSlider.addEventListener(
		EVENT_INPUT,
		() => {
			profile = { ...profile, micThreshold: Number(micSlider.value) }
			syncFields()
		},
		{ signal: abort.signal }
	)

	labelInput.addEventListener(
		EVENT_INPUT,
		() => {
			const trimmed = labelInput.value.trim()
			profile = trimmed ? { ...profile, label: trimmed } : { ...profile, label: undefined }
			urlInput.value = buildCurrentUrl()
		},
		{ signal: abort.signal }
	)

	sensorySelect.addEventListener(
		EVENT_CHANGE,
		() => {
			sensoryPreset = sensorySelect.value as "none" | "low-vision" | "deaf-tactile"
			if (sensoryPreset === "low-vision") {
				profile = {
					...profile,
					contrast: "high",
					targetSize: "xlarge",
					palette: "colorblind-safe",
					auditoryCue: "speech"
				}
			} else if (sensoryPreset === "deaf-tactile") {
				profile = {
					...profile,
					beatFlash: true,
					palette: "colorblind-safe",
					targetSize: "large"
				}
			}
			syncFields()
		},
		{ signal: abort.signal }
	)

	stageModeSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			profile = { ...profile, stageMode: stageModeSelect.value as FocusStageMode }
			syncFields()
		},
		{ signal: abort.signal }
	)
	padCountSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			profile = { ...profile, padCount: Number(padCountSelect.value) as FocusStagePadCount }
			syncFields()
		},
		{ signal: abort.signal }
	)
	scanModeSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			profile = { ...profile, scanMode: scanModeSelect.value as SwitchScanMode }
			syncFields()
		},
		{ signal: abort.signal }
	)
	scanMsSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			profile = { ...profile, scanMs: Number(scanMsSelect.value) || 1000 }
			syncFields()
		},
		{ signal: abort.signal }
	)
	releaseModeSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			profile = { ...profile, releaseMode: releaseModeSelect.value as SwitchReleaseMode }
			syncFields()
		},
		{ signal: abort.signal }
	)
	cueSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			profile = { ...profile, auditoryCue: cueSelect.value as AuditoryCueMode }
			syncFields()
		},
		{ signal: abort.signal }
	)
	dwellMsSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			profile = { ...profile, dwellMs: Number(dwellMsSelect.value) || 0 }
			syncFields()
		},
		{ signal: abort.signal }
	)
	roomInput.addEventListener(
		EVENT_INPUT,
		() => {
			roomId = roomInput.value
			urlInput.value = buildCurrentUrl()
		},
		{ signal: abort.signal }
	)
	roleSelect.addEventListener(
		EVENT_CHANGE,
		() => {
			seatRole = roleSelect.value as ClassroomRole | ""
			urlInput.value = buildCurrentUrl()
		},
		{ signal: abort.signal }
	)
	openStageCheck.addEventListener(
		EVENT_CHANGE,
		() => {
			profile = { ...profile, openFocusStage: openStageCheck.checked }
			urlInput.value = buildCurrentUrl()
		},
		{ signal: abort.signal }
	)

	copyBtn.addEventListener(
		EVENT_CLICK,
		() => {
			const link = buildCurrentUrl()
			urlInput.value = link
			const clip = doc.defaultView?.navigator?.clipboard
			if (clip?.writeText) {
				void clip
					.writeText(link)
					.then(() => {
						statusEl.textContent =
							"Copied bookmarkable learner link. Open it on any browser to restore this exact calibrated profile."
					})
					.catch(() => {
						urlInput.select()
						statusEl.textContent = "Link ready — select and copy from the box above."
					})
			} else {
				urlInput.select()
				statusEl.textContent = "Link ready — select and copy from the box above."
			}
		},
		{ signal: abort.signal }
	)

	const close = () => {
		if (dialog.open) {
			dialog.close()
		}
	}

	applyBtn.addEventListener(
		EVENT_CLICK,
		() => {
			const snapshot = { ...profile }
			close()
			onApply(snapshot, sensoryPreset)
		},
		{ signal: abort.signal }
	)
	closeBtn.addEventListener(EVENT_CLICK, close, { signal: abort.signal })
	cancelBtn.addEventListener(EVENT_CLICK, close, { signal: abort.signal })
	dialog.addEventListener(
		EVENT_CLOSE,
		() => {
			activeTapDownMs = null
			dwellEnterMs = null
		},
		{ signal: abort.signal }
	)

	const open = () => {
		tapSamples = []
		dwellSamples = []
		activeTapDownMs = null
		dwellEnterMs = null
		profile = {
			...DEFAULT_ACCESS_PROFILE,
			...accessibility.getPreferences(),
			...getStageConfig?.()
		}
		tapPad.textContent = "Tap or press Space (0 / 4)"
		tapResult.textContent = "Waiting for taps…"
		dwellResult.textContent = ""
		statusEl.textContent = ""
		syncFields()
		if (!dialog.open) {
			dialog.showModal()
		}
		tapPad.focus()
	}

	return {
		dialog,
		open,
		close,
		getProfile: () => ({ ...profile }),
		getUrl: buildCurrentUrl,
		destroy() {
			abort.abort()
			dialog.remove()
		}
	}
}
