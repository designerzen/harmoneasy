import { EVENT_CHANGE, EVENT_CLICK } from "audiobus/events/event-constants"
import { NOTE_NAMES, SCALE_FAMILIES } from "audiobus/io/harmony"
import { mapPitchSet } from "audiobus/tuning/pitch-class-set"
import type { AccessProfile } from "./access-profile"
import {
	CLASSROOM_ROLES,
	EVENT_CLASSROOM_CHANGED,
	buildSeatPresetUrl,
	describeHarmony,
	type ClassroomRole,
	type ClassroomSession
} from "./classroom-session"
import { element } from "./music-tools-dom"

export interface ClassroomPanelOptions {
	host: HTMLElement
	getRoomId: () => string | undefined
	getBpm: () => number
	getSwing: () => number
	getNow: () => number
	getAccessProfile?: () => Partial<AccessProfile> | undefined
	isConductor: () => boolean
	onHarmonyChange: (harmony: { root: number; scale: number; chord: number }) => void
	onStateUpdated: () => void
	onReleaseNotes: (peerId: string, commands: any[]) => void
	reportStatus: (message: string) => void
}

/** Non-React teacher/conductor and student classroom controls mounted inside Shared room. */
export function createClassroomPanel(options: ClassroomPanelOptions) {
	const abort = new AbortController()
	let session: ClassroomSession | undefined
	let sessionAbort: AbortController | undefined

	const details = element("details")
	details.id = "classroom-controls"
	const summary = element("summary", "Classroom & jam roles")
	const body = element("div")
	body.className = "classroom-panel"

	const status = element("p")
	status.id = "classroom-status"
	status.className = "classroom-status"
	status.setAttribute("role", "status")

	// Harmony lock bar (conductor controls)
	const harmonySection = element("fieldset")
	harmonySection.className = "classroom-section"
	harmonySection.append(element("legend", "Room key & scale"))

	const lockLabel = element("label")
	lockLabel.className = "classroom-toggle"
	const lockCheckbox = element("input")
	lockCheckbox.type = "checkbox"
	lockCheckbox.id = "classroom-lock-harmony"
	lockLabel.append(lockCheckbox, "Lock everyone to room key and scale")

	const harmonyRow = element("div")
	harmonyRow.className = "classroom-harmony-row"

	const tonicLabel = element("label")
	tonicLabel.append("Key")
	const tonicSelect = element("select")
	tonicSelect.id = "classroom-tonic"
	NOTE_NAMES.forEach((name, index) => {
		const opt = element("option", name)
		opt.value = String(index)
		tonicSelect.append(opt)
	})
	tonicLabel.append(tonicSelect)

	const scaleLabel = element("label")
	scaleLabel.append("Scale")
	const scaleSelect = element("select")
	scaleSelect.id = "classroom-scale"
	for (const family of SCALE_FAMILIES) {
		const opt = element("option", family.name)
		opt.value = String(family.mask)
		scaleSelect.append(opt)
	}
	scaleLabel.append(scaleSelect)

	harmonyRow.append(tonicLabel, scaleLabel)
	harmonySection.append(lockLabel, harmonyRow)

	// Student read-only banner
	const studentBanner = element("div")
	studentBanner.id = "classroom-student-banner"
	studentBanner.className = "classroom-student-banner"
	studentBanner.hidden = true

	// Seat roster (conductor)
	const rosterSection = element("fieldset")
	rosterSection.className = "classroom-section"
	rosterSection.append(element("legend", "Seats & roles"))
	const rosterList = element("div")
	rosterList.id = "classroom-seats"
	rosterList.className = "classroom-seats"
	rosterSection.append(rosterList)

	// Quick seat link generator for /parts/v1/ presets
	const inviteBar = element("div")
	inviteBar.className = "classroom-invite-bar"
	const quickRoleLabel = element("label")
	quickRoleLabel.append("Seat preset role")
	const quickRoleSelect = element("select")
	quickRoleSelect.id = "classroom-quick-role"
	for (const role of CLASSROOM_ROLES) {
		const opt = element("option", role.label)
		opt.value = role.id
		quickRoleSelect.append(opt)
	}
	quickRoleSelect.value = "chords"
	quickRoleLabel.append(quickRoleSelect)

	const copyRoleLink = element("button", "Copy role preset link")
	copyRoleLink.type = "button"
	copyRoleLink.id = "classroom-copy-role-link"

	const includeAccessLabel = element("label")
	includeAccessLabel.className = "classroom-toggle"
	const includeAccessCheckbox = element("input")
	includeAccessCheckbox.type = "checkbox"
	includeAccessCheckbox.id = "classroom-include-access"
	includeAccessLabel.append(
		includeAccessCheckbox,
		"Include calibrated accessibility profile in seat links"
	)

	inviteBar.append(quickRoleLabel, copyRoleLink, includeAccessLabel)
	rosterSection.append(inviteBar)

	// Multi-track jam export section
	const exportSection = element("fieldset")
	exportSection.className = "classroom-section"
	exportSection.append(element("legend", "Combined multi-track jam export"))
	const jamSummary = element("p", "No room notes recorded yet.")
	jamSummary.id = "classroom-jam-summary"
	jamSummary.className = "classroom-jam-summary"
	const exportActions = element("div")
	exportActions.className = "classroom-export-actions"
	const exportDaw = element("button", "Export DAWproject")
	exportDaw.type = "button"
	exportDaw.id = "classroom-export-dawproject"
	const exportXml = element("button", "Export MusicXML")
	exportXml.type = "button"
	exportXml.id = "classroom-export-musicxml"
	const clearJam = element("button", "Clear jam")
	clearJam.type = "button"
	clearJam.id = "classroom-clear-jam"
	exportActions.append(exportDaw, exportXml, clearJam)
	exportSection.append(jamSummary, exportActions)

	body.append(studentBanner, harmonySection, rosterSection, exportSection, status)
	details.append(summary, body)
	options.host.append(details)

	const copySeatLink = async (role: ClassroomRole, seatName?: string) => {
		try {
			const accessProfile = includeAccessCheckbox.checked
				? options.getAccessProfile?.()
				: undefined
			const url = buildSeatPresetUrl({
				location: window.location.href,
				base: import.meta.env.BASE_URL ?? "/",
				roomId: options.getRoomId(),
				role,
				seatName,
				bpm: options.getBpm(),
				swing: options.getSwing(),
				accessProfile
			})
			await navigator.clipboard.writeText(url)
			const roleLabel = CLASSROOM_ROLES.find((r) => r.id === role)?.label ?? role
			status.textContent = accessProfile
				? `Copied ${roleLabel} seat link with calibrated accessibility profile.`
				: `Copied ${roleLabel} seat preset link.`
		} catch (error) {
			status.textContent =
				error instanceof Error ? error.message : "Could not copy seat link."
		}
	}

	const applyHarmonyFromControls = () => {
		if (!session || !options.isConductor()) {
			return
		}
		const root = Number(tonicSelect.value)
		const mask = Number(scaleSelect.value)
		const previous = session.currentHarmony
		const next = {
			root,
			scale: mapPitchSet(mask, 1, root),
			chord: mapPitchSet(previous.chord, 1, root - previous.root)
		}
		session.setHarmony(next)
		options.onHarmonyChange(next)
		options.onStateUpdated()
	}

	lockCheckbox.addEventListener(
		EVENT_CHANGE,
		() => {
			if (!session || !options.isConductor()) {
				return
			}
			session.setLockHarmony(lockCheckbox.checked)
			options.onStateUpdated()
		},
		{ signal: abort.signal }
	)

	tonicSelect.addEventListener(EVENT_CHANGE, applyHarmonyFromControls, { signal: abort.signal })
	scaleSelect.addEventListener(EVENT_CHANGE, applyHarmonyFromControls, { signal: abort.signal })

	copyRoleLink.addEventListener(
		EVENT_CLICK,
		() => void copySeatLink(quickRoleSelect.value as ClassroomRole),
		{ signal: abort.signal }
	)

	const runExport = async (formatId: "dawproject" | "musicxml") => {
		if (!session) {
			status.textContent = "Start or join a room first to capture a jam."
			return
		}
		exportDaw.disabled = exportXml.disabled = true
		try {
			const result = await session.exportJam(formatId, {
				name: options.getRoomId()
					? `Harmoneasy-${options.getRoomId()}-jam`
					: "Harmoneasy-classroom-jam",
				bpm: options.getBpm(),
				now: options.getNow()
			})
			status.textContent = `Exported ${result.filename} (${result.trackCount} ${result.trackCount === 1 ? "track" : "tracks"}, ${result.noteCount} notes).`
			options.reportStatus(status.textContent)
		} catch (error) {
			status.textContent = error instanceof Error ? error.message : String(error)
		} finally {
			render()
		}
	}

	exportDaw.addEventListener(EVENT_CLICK, () => void runExport("dawproject"), {
		signal: abort.signal
	})
	exportXml.addEventListener(EVENT_CLICK, () => void runExport("musicxml"), {
		signal: abort.signal
	})
	clearJam.addEventListener(
		EVENT_CLICK,
		() => {
			session?.clearJam()
			status.textContent = "Cleared captured room notes."
			render()
		},
		{ signal: abort.signal }
	)

	const render = () => {
		const active = Boolean(session)
		const conductor = !active || options.isConductor()
		harmonySection.hidden = !conductor
		rosterSection.hidden = !conductor
		exportSection.hidden = !conductor

		if (!session) {
			studentBanner.hidden = true
			lockCheckbox.disabled = true
			tonicSelect.disabled = true
			scaleSelect.disabled = true
			rosterList.replaceChildren(
				element("p", "Start a room to manage student seats, mute/solo, and lock harmony.")
			)
			jamSummary.textContent = "Start a room to capture multi-track jam notes."
			exportDaw.disabled = exportXml.disabled = clearJam.disabled = true
			return
		}

		const state = session.getState()
		const harmonyText = describeHarmony(state.harmony)

		if (!conductor) {
			const seat = session.localSeat
			const roleDef =
				CLASSROOM_ROLES.find((r) => r.id === (seat?.role ?? "free")) ?? CLASSROOM_ROLES[0]
			const playState = !session.canPeerPlay(session.localPeerId)
				? "Muted by conductor"
				: seat?.solo
					? "Soloed"
					: "Active"
			studentBanner.hidden = false
			studentBanner.replaceChildren(
				element("strong", `${seat?.name ?? "Student"} · ${roleDef.label}`),
				element(
					"p",
					`${playState} · ${state.lockHarmony ? `Locked to ${harmonyText}` : `Room key: ${harmonyText}`}`
				)
			)
			return
		}

		studentBanner.hidden = true
		lockCheckbox.disabled = false
		tonicSelect.disabled = false
		scaleSelect.disabled = false
		lockCheckbox.checked = state.lockHarmony
		tonicSelect.value = String(state.harmony.root)
		const relativeMask = mapPitchSet(state.harmony.scale, 1, -state.harmony.root)
		if (SCALE_FAMILIES.some((family) => family.mask === relativeMask)) {
			scaleSelect.value = String(relativeMask)
		}

		rosterList.replaceChildren()
		for (const seat of state.seats) {
			const row = element("div")
			row.className = "classroom-seat"
			row.dataset.peerId = seat.peerId

			const nameInput = element("input")
			nameInput.type = "text"
			nameInput.value = seat.name
			nameInput.maxLength = 64
			nameInput.className = "classroom-seat-name"
			nameInput.setAttribute("aria-label", `Name for ${seat.name}`)
			nameInput.addEventListener(EVENT_CHANGE, () => {
				session?.setSeatName(seat.peerId, nameInput.value)
				options.onStateUpdated()
			})

			const roleSelect = element("select")
			roleSelect.className = "classroom-seat-role"
			roleSelect.setAttribute("aria-label", `Role for ${seat.name}`)
			for (const role of CLASSROOM_ROLES) {
				const opt = element("option", role.label)
				opt.value = role.id
				roleSelect.append(opt)
			}
			roleSelect.value = seat.role
			roleSelect.addEventListener(EVENT_CHANGE, () => {
				session?.setSeatRole(seat.peerId, roleSelect.value as ClassroomRole)
				options.onStateUpdated()
			})

			const muteBtn = element("button", "Mute")
			muteBtn.type = "button"
			muteBtn.className = "classroom-seat-mute"
			muteBtn.setAttribute("aria-pressed", String(seat.muted))
			muteBtn.addEventListener(EVENT_CLICK, () => {
				if (!session) {
					return
				}
				const releases = session.setSeatMuted(seat.peerId, !seat.muted, options.getNow())
				if (releases.length) {
					options.onReleaseNotes(seat.peerId, releases)
				}
				options.onStateUpdated()
			})

			const soloBtn = element("button", "Solo")
			soloBtn.type = "button"
			soloBtn.className = "classroom-seat-solo"
			soloBtn.setAttribute("aria-pressed", String(seat.solo))
			soloBtn.addEventListener(EVENT_CLICK, () => {
				if (!session) {
					return
				}
				const releases = session.setSeatSolo(seat.peerId, !seat.solo, options.getNow())
				if (releases.length) {
					options.onReleaseNotes(seat.peerId, releases)
				}
				options.onStateUpdated()
			})

			const linkBtn = element("button", "Copy link")
			linkBtn.type = "button"
			linkBtn.className = "classroom-seat-link"
			linkBtn.title = `Copy /parts/v1/ setup link for ${seat.name}`
			linkBtn.addEventListener(EVENT_CLICK, () => void copySeatLink(seat.role, seat.name))

			row.append(nameInput, roleSelect, muteBtn, soloBtn, linkBtn)
			rosterList.append(row)
		}

		const notes = session.jamNoteCount
		const players = session.jamParticipantCount
		jamSummary.textContent = notes
			? `${notes} ${notes === 1 ? "note" : "notes"} captured across ${players} ${players === 1 ? "seat" : "seats"}.`
			: "No room notes recorded yet. Play together, then export."
		exportDaw.disabled = exportXml.disabled = clearJam.disabled = notes === 0
	}

	render()

	return {
		element: details,
		attach(next: ClassroomSession | undefined) {
			sessionAbort?.abort()
			session = next
			if (next) {
				sessionAbort = new AbortController()
				next.addEventListener(EVENT_CLASSROOM_CHANGED, render, {
					signal: sessionAbort.signal
				})
			}
			render()
		},
		refresh: render,
		destroy() {
			sessionAbort?.abort()
			abort.abort()
			details.remove()
		}
	}
}
