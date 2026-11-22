// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import AbstractInput from "../../../packages/audiobus/io/inputs/abstract-input"
import InputAudioEvent from "../../../packages/audiobus/io/events/input-audio-event"
import { NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"
import { DEFAULT_HARMONY, SCALE_FAMILIES } from "../../../packages/audiobus/io/harmony"
import { mapPitchSet } from "../../../packages/audiobus/tuning/pitch-class-set"
import {
	CLASSROOM_ROLES,
	ClassroomSession,
	buildSeatPresetUrl,
	describeHarmony,
	keySignatureFromHarmony,
	parseClassroomState
} from "../source/services/classroom-session"
import { createClassroomPanel } from "../source/services/classroom-panel"
import { RoomWorkspace } from "../source/services/room-workspace"
import { parsePartsUrl } from "../source/services/parts-url"
import { loadPresetPage } from "../source/services/preset-page"
import { readRoomUrl } from "../source/services/room-url"

class TestInput extends AbstractInput {
	destroy() {}
}

const cleanup: Array<() => void> = []
afterEach(() => {
	for (const dispose of cleanup.splice(0)) {
		dispose()
	}
	document.body.replaceChildren()
	vi.restoreAllMocks()
})

const makeNote = (number: number, type = NOTE_ON, velocity = type === NOTE_ON ? 100 : 0) =>
	({
		type,
		number,
		velocity,
		channel: 1,
		value: 0,
		pitchBend: 0,
		raw: new Uint8Array(),
		from: "keyboard",
		startAt: 0,
		time: 0
	}) as any

function makeMachine(
	id: string,
	role: "leader" | "follower",
	mode: "workspace" | "harmony" = "workspace"
) {
	const sink = {
		uuid: id,
		name: "synth",
		description: "",
		isConnected: true,
		isHidden: false,
		noteOn: vi.fn(),
		noteOff: vi.fn(),
		allNotesOff: vi.fn()
	}
	const input = new TestInput()
	const timer = {
		now: 0,
		BPM: 120,
		position: 0,
		isRunning: true,
		start: vi.fn(),
		stop: vi.fn()
	} as any
	const manager = new IOChainManager({
		timer,
		outputMixer: {} as GainNode,
		externalDevices: { input, sink }
	})
	const chain = new IOChain(timer)
	chain.setTransformers([])
	chain.addInput(input)
	chain.addOutput(sink)
	manager.addChain(chain, "classroom-chain")

	const links = new Map<string, ReturnType<typeof makeMachine>["connection"]>()
	const connection = {
		id,
		role,
		clockLocked: true,
		leaderTimeMs: 0,
		playbackDelayMs: 0,
		onPeerOpen: undefined as any,
		onPeerClose: undefined as any,
		onData: undefined as any,
		onClockChange: undefined as any,
		onConductorChange: undefined as any,
		sendData: vi.fn((peer: string, message: unknown) => {
			const data = structuredClone(message)
			queueMicrotask(() => links.get(peer)?.onData?.(id, data))
			return true
		}),
		broadcastData(message: unknown) {
			for (const peer of links.keys()) {
				this.sendData(peer, message)
			}
		}
	}
	const report = vi.fn()
	const workspace = new RoomWorkspace(connection as any, manager, () => timer.now, report, mode)
	cleanup.push(() => {
		void workspace.destroy()
		manager.destroy()
	})
	return { manager, sink, input, timer, connection, links, workspace, report }
}

function pair(host: ReturnType<typeof makeMachine>, guest: ReturnType<typeof makeMachine>) {
	host.links.set(guest.connection.id, guest.connection)
	guest.links.set(host.connection.id, host.connection)
	guest.connection.onPeerOpen(host.connection.id)
	host.connection.onPeerOpen(guest.connection.id)
}

describe("ClassroomSession controls and transformations", () => {
	it("locks students to the room key/scale and expands roles for chords, bass, and rhythm", () => {
		const session = new ClassroomSession("teacher", true, DEFAULT_HARMONY)
		session.ensurePeer("student-chords", false)
		session.ensurePeer("student-bass", false)
		session.ensurePeer("student-rhythm", false)
		session.setLockHarmony(true)
		session.setSeatRole("student-chords", "chords")
		session.setSeatRole("student-bass", "bass")
		session.setSeatRole("student-rhythm", "rhythm")

		// C# (61) snaps to C major (60) and expands to C-E-G triad (60, 64, 67).
		const chordOn = session.processPeerCommand("student-chords", makeNote(61, NOTE_ON), 1.0)
		expect(chordOn.map((c) => c.number)).toEqual([60, 64, 67])

		// Releasing C# releases the exact mapped triad even if harmony later changes.
		const dDorian = {
			root: 2,
			scale: mapPitchSet(SCALE_FAMILIES.find((f) => f.name === "Dorian")!.mask, 1, 2),
			chord: DEFAULT_HARMONY.chord
		}
		session.setHarmony(dDorian)
		const chordOff = session.processPeerCommand("student-chords", makeNote(61, NOTE_OFF), 1.5)
		expect(chordOff.map((c) => c.number)).toEqual([60, 64, 67])

		// High note on bass seat folds into bass register (36..59) in D Dorian.
		const bassOn = session.processPeerCommand("student-bass", makeNote(74, NOTE_ON), 2.0)
		expect(bassOn).toHaveLength(1)
		expect(bassOn[0].number).toBeGreaterThanOrEqual(36)
		expect(bassOn[0].number).toBeLessThanOrEqual(59)
		expect(bassOn[0].number % 12).toBe(2) // D

		// Rhythm seat routes to MIDI percussion channel 10 without pitch snapping.
		const drumOn = session.processPeerCommand("student-rhythm", makeNote(36, NOTE_ON), 2.5)
		expect(drumOn).toHaveLength(1)
		expect(drumOn[0].channel).toBe(10)
		expect(drumOn[0].number).toBe(36)
	})

	it("enforces mute and solo gating and releases active notes immediately when muted", () => {
		const session = new ClassroomSession("teacher", true, DEFAULT_HARMONY)
		session.ensurePeer("student-a", false)
		session.ensurePeer("student-b", false)

		expect(session.processPeerCommand("student-a", makeNote(60, NOTE_ON), 0.5)).toHaveLength(1)

		// Muting student-a releases their held C4 immediately and blocks new notes.
		const releases = session.setSeatMuted("student-a", true, 1.0)
		expect(releases.map((c) => [c.type, c.number])).toEqual([[NOTE_OFF, 60]])
		expect(session.processPeerCommand("student-a", makeNote(64, NOTE_ON), 1.2)).toEqual([])

		// Soloing student-b blocks teacher and student-a while letting student-b play.
		session.setSeatMuted("student-a", false, 1.3)
		session.setSeatSolo("student-b", true, 1.4)
		expect(session.canPeerPlay("student-b")).toBe(true)
		expect(session.canPeerPlay("student-a")).toBe(false)
		expect(session.canPeerPlay("teacher")).toBe(false)
		expect(session.processPeerCommand("student-a", makeNote(64, NOTE_ON), 1.5)).toEqual([])
		expect(session.processPeerCommand("student-b", makeNote(67, NOTE_ON), 1.6)).toHaveLength(1)

		// Clearing solo restores everyone who is not muted.
		session.setSeatSolo("student-b", false, 2.0)
		expect(session.canPeerPlay("student-a")).toBe(true)
		expect(session.canPeerPlay("teacher")).toBe(true)
	})

	it("builds valid /parts/v1/ seat preset URLs for every role with room routing", async () => {
		const origin = "https://example.test/harmoneasy/"
		const base = "/harmoneasy/"
		for (const role of CLASSROOM_ROLES) {
			const url = buildSeatPresetUrl({
				location: origin,
				base,
				roomId: "room-4a",
				role: role.id,
				seatName: `Seat ${role.id}`,
				bpm: 112,
				swing: 0.15
			})
			expect(parsePartsUrl(url, base)).toBeDefined()
			expect(readRoomUrl(url).roomId).toBe("room-4a")
			const page = await loadPresetPage(url, base)
			expect(page).toBeDefined()
			expect(page!.clock.bpm).toBe(112)
			expect(page!.name).toContain(role.label)
		}
	})

	it("exports a combined multi-track jam to both DAWproject and MusicXML", async () => {
		const session = new ClassroomSession("teacher", true, {
			root: 7, // G major
			scale: mapPitchSet(SCALE_FAMILIES[0].mask, 1, 7),
			chord: DEFAULT_HARMONY.chord
		})
		session.setSeatName("teacher", "Ms Patel")
		session.setSeatRole("teacher", "chords")
		session.ensurePeer("student-1", false)
		session.setSeatName("student-1", "Alex")
		session.setSeatRole("student-1", "melody")
		session.ensurePeer("student-2", false)
		session.setSeatName("student-2", "Sam")
		session.setSeatRole("student-2", "rhythm")
		session.setLockHarmony(true)

		session.processPeerCommand("teacher", makeNote(67, NOTE_ON), 0)
		session.processPeerCommand("teacher", makeNote(67, NOTE_OFF), 0.5)
		session.processPeerCommand("student-1", makeNote(71, NOTE_ON), 0.5)
		session.processPeerCommand("student-1", makeNote(71, NOTE_OFF), 1.0)
		session.processPeerCommand("student-2", makeNote(36, NOTE_ON), 0.25)
		session.processPeerCommand("student-2", makeNote(36, NOTE_OFF), 0.5)

		const song = session.buildJamSong({ name: "Period 3 Jam", bpm: 108 })
		expect(song.key).toEqual({ fifths: 1, mode: "major" })
		expect(song.tracks.map((t) => t.name)).toEqual([
			"Ms Patel (Chords)",
			"Alex (Melody)",
			"Sam (Rhythm)"
		])
		expect(song.tracks[2].channel).toBe(10)

		const daw = await session.exportJam("dawproject", {
			name: "Period 3 Jam",
			bpm: 108,
			download: false
		})
		expect(daw.trackCount).toBe(3)
		expect(daw.noteCount).toBe(5) // 3 chord tones + 1 melody + 1 drum hit
		expect(daw.blob.size).toBeGreaterThan(100)
		// ZIP magic header PK\x03\x04
		const zipHeader = new Uint8Array(await daw.blob.arrayBuffer()).slice(0, 2)
		expect(Array.from(zipHeader)).toEqual([0x50, 0x4b])

		const xml = await session.exportJam("musicxml", {
			name: "Period 3 Jam",
			bpm: 108,
			download: false
		})
		const xmlText = await xml.blob.text()
		expect(xmlText).toContain("<score-partwise")
		expect(xmlText).toContain("Ms Patel (Chords)")
		expect(xmlText).toContain("Alex (Melody)")
		expect(xmlText).toContain("Sam (Rhythm)")
	})

	it("validates untrusted remote classroom state and describes keys", () => {
		expect(() => parseClassroomState({ lockHarmony: true, seats: "bad" })).toThrow()
		expect(describeHarmony(DEFAULT_HARMONY)).toBe("C Major")
		expect(
			keySignatureFromHarmony({
				root: 9,
				scale: mapPitchSet(SCALE_FAMILIES[1].mask, 1, 9),
				chord: DEFAULT_HARMONY.chord
			})
		).toEqual({ fifths: 0, mode: "minor" })
	})
})

describe("RoomWorkspace P2P classroom synchronization", () => {
	it("syncs harmony lock, mute/solo, and role assignment from conductor to student", async () => {
		const host = makeMachine("teacher", "leader")
		const student = makeMachine("student-1", "follower")
		pair(host, student)

		await vi.waitFor(() => expect(student.report).toHaveBeenCalledWith(expect.stringContaining("Room ready")))

		// Teacher locks the room to D minor and assigns student to chords.
		const dMinor = {
			root: 2,
			scale: mapPitchSet(SCALE_FAMILIES[1].mask, 1, 2),
			chord: DEFAULT_HARMONY.chord
		}
		host.manager.setHarmony(dMinor)
		host.workspace.classroom.setLockHarmony(true)
		host.workspace.classroom.setSeatRole("student-1", "chords")
		host.workspace.broadcastClassroom()

		await vi.waitFor(() => {
			expect(student.workspace.classroom.isHarmonyLocked).toBe(true)
			expect(student.manager.externallyControlledHarmony).toBe(true)
			expect(student.manager.harmony.root).toBe(2)
			expect(student.workspace.classroom.localSeat?.role).toBe("chords")
		})

		// Mute student and verify their incoming notes are blocked on host.
		host.workspace.classroom.setSeatMuted("student-1", true, 1)
		host.workspace.broadcastClassroom()
		await vi.waitFor(() => expect(student.workspace.classroom.canPeerPlay("student-1")).toBe(false))

		student.manager.activeChain!.onInputEvent(new InputAudioEvent(makeNote(62, NOTE_ON)))
		await new Promise((resolve) => setTimeout(resolve, 25))
		host.manager.updateTime(1, 1)
		expect(host.sink.noteOn).not.toHaveBeenCalled()

		// Unmute student and verify their note expands into a D minor triad on host.
		host.workspace.classroom.setSeatMuted("student-1", false, 2)
		host.workspace.broadcastClassroom()
		student.manager.activeChain!.onInputEvent(new InputAudioEvent(makeNote(62, NOTE_ON)))
		await vi.waitFor(() => expect(host.workspace.classroom.jamNoteCount).toBe(3))
	})
})

describe("Non-React classroom conductor panel", () => {
	it("renders conductor controls for host and read-only seat status for student", () => {
		const host = document.createElement("div")
		document.body.append(host)
		let conductor = true
		const onHarmonyChange = vi.fn()
		const onStateUpdated = vi.fn()
		const onReleaseNotes = vi.fn()
		const session = new ClassroomSession("teacher", true, DEFAULT_HARMONY)
		session.ensurePeer("student-1", false)

		const panel = createClassroomPanel({
			host,
			getRoomId: () => "music-101",
			getBpm: () => 116,
			getSwing: () => 0,
			getNow: () => 1,
			isConductor: () => conductor,
			onHarmonyChange,
			onStateUpdated,
			onReleaseNotes,
			reportStatus: vi.fn()
		})
		cleanup.push(() => panel.destroy())
		panel.attach(session)

		// Lock harmony toggle updates session and notifies host broadcast.
		const lock = document.getElementById("classroom-lock-harmony") as HTMLInputElement
		lock.checked = true
		lock.dispatchEvent(new Event("change"))
		expect(session.isHarmonyLocked).toBe(true)
		expect(onStateUpdated).toHaveBeenCalled()

		// Assign student-1 to rhythm and mute them via DOM buttons.
		const studentRow = document.querySelector<HTMLElement>('[data-peer-id="student-1"]')!
		const roleSelect = studentRow.querySelector<HTMLSelectElement>(".classroom-seat-role")!
		roleSelect.value = "rhythm"
		roleSelect.dispatchEvent(new Event("change"))
		expect(session.getSeat("student-1")?.role).toBe("rhythm")

		const muteBtn = studentRow.querySelector<HTMLButtonElement>(".classroom-seat-mute")!
		muteBtn.click()
		expect(session.getSeat("student-1")?.muted).toBe(true)

		// Switching to student view hides conductor sections and renders read-only banner.
		conductor = false
		panel.refresh()
		const banner = document.getElementById("classroom-student-banner")!
		expect(banner.hidden).toBe(false)
		expect(banner.textContent).toContain("Locked to C Major")
	})
})
