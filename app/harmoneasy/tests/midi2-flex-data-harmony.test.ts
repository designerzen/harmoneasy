// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { registerEndpointMidi2IPC, validateUMPWords } from "../electron/endpoint-midi2-backend.js"
import {
	FlexDataHarmonyAdapter,
	decodeFlexDataUmp,
	encodeFlexChordNameUmp,
	encodeFlexKeySignatureUmp,
	encodeFlexTempoUmp
} from "../../../packages/audiobus/midi/flex-data"
import { getNativeMidiBridge } from "../../../packages/audiobus/midi/native-midi-bridge"
import { TransformerChordTrack } from "../../../packages/audiobus/io/transformers/transformer-chord-track"
import { TransformerConstrictor } from "../../../packages/audiobus/io/transformers/transformer-constrictor"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_OFF, NOTE_ON } from "../../../packages/audiobus/commands/commands"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import { mountFlexDataBridge } from "../source/services/harmony-flex-data"

const cmd = (number: number, type = NOTE_ON, velocity = type === NOTE_ON ? 96 : 0, startAt = 0) =>
	musicalCommand({ type, number, velocity, channel: 1, from: "keys", startAt })

const clock = (now = 0) => ({ now, BPM: 120 }) as any

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

describe("MIDI 2.0 Flex Data codec", () => {
	it("round-trips Set Tempo, Set Key Signature, and Set Chord Name with slash bass", () => {
		const tempoPacket = encodeFlexTempoUmp(125)
		expect(validateUMPWords(tempoPacket)).toEqual(tempoPacket)
		const decodedTempo = decodeFlexDataUmp(tempoPacket)
		expect(decodedTempo?.kind).toBe("tempo")
		if (decodedTempo?.kind === "tempo") {
			expect(decodedTempo.bpm).toBeCloseTo(125, 2)
		}

		// G major key signature (+1 sharp, tonic G = 7: C D E F# G A B)
		const gMajorMask =
			(1 << 0) | (1 << 2) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 9) | (1 << 11)
		const keyPacket = encodeFlexKeySignatureUmp({ root: 7, scale: gMajorMask })
		const decodedKey = decodeFlexDataUmp(keyPacket)
		expect(decodedKey).toMatchObject({
			kind: "keySignature",
			sharpsOrFlats: 1,
			root: 7,
			scale: gMajorMask
		})

		// C major / E slash chord (root=0, chord=C-E-G=145, bass=4)
		const chordPacket = encodeFlexChordNameUmp({ root: 0, chord: 145, bass: 4 })
		const decodedChord = decodeFlexDataUmp(chordPacket)
		expect(decodedChord).toMatchObject({
			kind: "chordName",
			root: 0,
			chord: 145,
			bass: 4,
			name: "C/E"
		})
	})

	it("coalesces rapid Set Key Signature and Set Chord Name packets over a 50ms window", () => {
		vi.useFakeTimers()
		const onHarmony = vi.fn()
		const onTempo = vi.fn()
		const adapter = new FlexDataHarmonyAdapter({ coalesceMs: 50, onHarmony, onTempo })

		adapter.feed(encodeFlexKeySignatureUmp({ root: 9, scale: 2741 })) // A natural minor (0 sharps)
		adapter.feed(encodeFlexChordNameUmp({ root: 9, chord: 0b001000010001, bass: 4 })) // Am/E
		adapter.feed(encodeFlexTempoUmp(110))

		expect(onTempo).toHaveBeenCalledTimes(1)
		expect(onHarmony).not.toHaveBeenCalled()
		vi.advanceTimersByTime(50)
		expect(onHarmony).toHaveBeenCalledTimes(1)
		expect(onHarmony).toHaveBeenLastCalledWith(
			{ root: 9, scale: 2741, chord: 0b001000010001, bass: 4 },
			"Am/E"
		)
		adapter.destroy()
	})
})

describe("Booth Bridge accessible remapping and range folding", () => {
	it("maps white keys into fixed-octave chord tones, ignores black keys, and keeps common tones stable", () => {
		const track = new TransformerChordTrack({
			source: "live",
			follow: "chord",
			mapping: "white-keys"
		})
		// C major (C=0, E=4, G=7): C4->C4(60), D4->E4(64), E4->G4(67), F4->C5(72), C#4->ignored
		expect(track.transform([cmd(61)], clock())).toEqual([])
		expect(track.transform([cmd(60)], clock())[0].number).toBe(60)
		expect(track.transform([cmd(62)], clock())[0].number).toBe(64)
		expect(track.transform([cmd(64)], clock())[0].number).toBe(67)
		expect(track.transform([cmd(65)], clock())[0].number).toBe(72)

		// Change to A minor (C=0, E=4, A=9): C4 stays C4(60), D4 stays E4(64), E4 moves to A4(69)
		track.setHarmony({ root: 9, scale: 2741, chord: 0b001000010001 })
		expect(track.transform([cmd(60, NOTE_ON, 96, 1)], clock(1))[0].number).toBe(60)
		expect(track.transform([cmd(62, NOTE_ON, 96, 1)], clock(1))[0].number).toBe(64)
		expect(track.transform([cmd(64, NOTE_ON, 96, 1)], clock(1))[0].number).toBe(69)
	})

	it("maps 3-key root/fifth bass groups respecting slash bass and diminished fifths", () => {
		const track = new TransformerChordTrack({
			source: "live",
			follow: "chord",
			mapping: "root-fifth"
		})
		// B diminished (B=11, D=2, F=5) with slash bass D (2): 3 keys -> bass D(62), next 3 -> F(65)
		track.setHarmony({ root: 11, scale: 2741, chord: (1 << 11) | (1 << 2) | (1 << 5), bass: 2 })
		expect(track.transform([cmd(60)], clock())[0].number).toBe(62)
		expect(track.transform([cmd(62)], clock())[0].number).toBe(62)
		expect(track.transform([cmd(64)], clock())[0].number).toBe(62)
		expect(track.transform([cmd(65)], clock())[0].number).toBe(65)
	})

	it("re-pitches held notes on harmony change with note-offs before note-ons while keeping common tones", () => {
		const track = new TransformerChordTrack({
			source: "live",
			follow: "chord",
			mapping: "white-keys",
			repitch: 1
		})
		// Hold D4 (-> E4=64) and E4 (-> G4=67) on C major
		expect(track.transform([cmd(62, NOTE_ON, 80, 0), cmd(64, NOTE_ON, 90, 0)], clock(0)).map((c) => c.number)).toEqual([
			64,
			67
		])

		// Change to A minor (C, E, A): E4(64) stays sounding, G4(67) releases and re-strikes A4(69) with velocity 90
		track.setHarmony({ root: 9, scale: 2741, chord: (1 << 0) | (1 << 4) | (1 << 9) })
		const updates = track.tick(1, clock(1))
		expect(updates.map((c) => [c.type, c.number, c.velocity])).toEqual([
			[NOTE_OFF, 67, 0],
			[NOTE_ON, 69, 90]
		])
	})

	it("folds notes into the configured octave range and releases the folded pitch", () => {
		const constrictor = new TransformerConstrictor({
			enabled: 1,
			"lowest octave": 4,
			"highest octave": 5
		})
		const on = constrictor.transform([cmd(36, NOTE_ON), cmd(96, NOTE_ON)], clock())
		expect(on.map((c) => c.number)).toEqual([48, 60])
		const off = constrictor.transform([cmd(36, NOTE_OFF), cmd(96, NOTE_OFF)], clock())
		expect(off.map((c) => c.number)).toEqual([48, 60])
	})
})

describe("PhotoSYNTH endpoint MIDI 2.0 backend integration", () => {
	it("registers endpoint IPC and prefers window.electron.midi when available", async () => {
		const handlers = new Map<string, (...args: any[]) => any>()
		const syncListeners = new Map<string, (...args: any[]) => any>()
		const sent: Array<{ channel: string; payload: any }> = []
		const ipcMain = {
			on: (ch: string, fn: any) => syncListeners.set(ch, fn),
			handle: (ch: string, fn: any) => handlers.set(ch, fn)
		}
		const sendMock = vi.fn()
		let onMessageCb: ((msg: any) => void) | undefined
		const binding = {
			start: ({ onMessage }: any) => {
				onMessageCb = onMessage
				return { ports: [{ id: "win-1", name: "WMS Loopback", type: "bidirectional" }] }
			},
			send: sendMock,
			stop: vi.fn()
		}
		const win = {
			isDestroyed: () => false,
			webContents: {
				isDestroyed: () => false,
				send: (channel: string, payload: any) => sent.push({ channel, payload })
			}
		}

		const controller = registerEndpointMidi2IPC(ipcMain, () => [win], () => binding)
		expect(controller.available).toBe(true)

		const flexPacket = encodeFlexChordNameUmp({ root: 0, chord: 145 })
		await handlers.get("midi:send")!(null, { portId: "win-1", words: flexPacket })
		expect(sendMock).toHaveBeenCalledWith("win-1", flexPacket, 0)

		onMessageCb!({ endpointId: "win-1", timestamp: 123, words: flexPacket })
		expect(sent).toEqual([{ channel: "midi:message", payload: { endpointId: "win-1", timestamp: 123, words: flexPacket } }])

		// Verify native-midi-bridge prefers window.electron.midi and drives mountFlexDataBridge
		const listeners = new Set<(msg: any) => void>()
		vi.stubGlobal("window", {
			electron: {
				midi: {
					available: true,
					getPorts: async () => handlers.get("midi:get-ports")!(),
					sendUMP: (portId: string, words: number[]) =>
						handlers.get("midi:send")!(null, { portId, words }),
					onMessage: (cb: any) => {
						listeners.add(cb)
						return () => listeners.delete(cb)
					},
					onPortsChanged: () => () => {}
				}
			}
		})

		const bridge = getNativeMidiBridge()
		expect((await bridge.getUmpInputs())[0].name).toBe("WMS Loopback")

		const timer = { now: 0, BPM: 120, isRunning: false } as any
		const manager = new IOChainManager({ timer, outputMixer: {} as GainNode })
		manager.addChain(new IOChain(timer), "keys")
		const host = document.createElement("div")
		const setTempo = vi.fn()
		const flexUi = mountFlexDataBridge(host, manager, () => 120, setTempo)

		const receiveBox = [...host.querySelectorAll("label")]
			.find((l) => l.textContent?.startsWith("Receive MIDI 2.0 Flex Data"))!
			.querySelector("input")!
		receiveBox.checked = true
		receiveBox.dispatchEvent(new Event("change"))
		await vi.waitFor(() => expect(listeners.size).toBeGreaterThan(0))

		const incoming = encodeFlexChordNameUmp({ root: 5, chord: (1 << 5) | (1 << 9) | (1 << 0) })
		for (const listener of listeners) {
			listener({ endpointId: "win-1", timestamp: 0, words: incoming })
		}
		await vi.waitFor(() => expect(manager.harmony.root).toBe(5))

		flexUi.destroy()
		manager.destroy()
		controller.destroy()
	})
})
