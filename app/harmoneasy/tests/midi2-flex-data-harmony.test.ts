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
			expect.objectContaining({ root: 9, chordRoot: 9, scale: 2741, chord: 0b001000010001, bass: 4 }),
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
		await vi.waitFor(() => expect(manager.harmony.chordRoot).toBe(5))
		expect(manager.harmony.root).toBe(0)

		flexUi.destroy()
		manager.destroy()
		controller.destroy()
	})
})

// Native fixtures below exercise actual UMP fields rather than only codec round trips.
import { encodeFlexTimeSignatureUmp, encodeFlexMetronomeUmp } from "../../../packages/audiobus/midi/flex-data"
import { commandToUmp, umpToCommand } from "../../../packages/audiobus/midi/ump-codec"
import { parseHarmony, sameHarmony } from "../../../packages/audiobus/io/harmony"
import { parseMusicTools, defaultMusicTools } from "../../../packages/audiobus/io/music-tools"
import { harmonyMetronomeClicks } from "../../../packages/audiobus/timing/harmony-metronome"

describe("independent Flex Data harmony and native expression", () => {
	it("keeps C major through C–Am–F–G7 and handles modulation in either packet order", () => {
		const adapter = new FlexDataHarmonyAdapter({ coalesceMs: 0 })
		for (const [root, chord] of [[0, 145], [9, 529], [5, 545], [7, 2212]]) {
			adapter.feed(encodeFlexChordNameUmp({ root, chord }))
			expect(adapter.state).toMatchObject({ root: 0, scale: 2741, chordRoot: root, chord })
		}
		adapter.feed(encodeFlexKeySignatureUmp({ root: 2, scale: 2774 }))
		expect(adapter.state).toMatchObject({ root: 2, scale: 2774, chordRoot: 7, chord: 2212 })
		adapter.feed(encodeFlexChordNameUmp({ root: 9, chord: 530 }))
		expect(adapter.state.root).toBe(2)
		adapter.destroy()
	})
	it("decodes accidental spelling from the signature, including B sharp in C sharp major", () => {
		expect(decodeFlexDataUmp([0xd0100005, 0x72000000, 0, 0])).toMatchObject({ root: 0, sharpsOrFlats: 7 })
		const packet = encodeFlexKeySignatureUmp({ root: 1, scale: 1387 }) // Db major
		expect((packet[1] >>> 24) & 15).toBe(4)
		expect(decodeFlexDataUmp(packet)).toMatchObject({ root: 1 })
	})
	it("marks arbitrary scales unknown and preserves received unknown signatures without changing the playable key", () => {
		const packet = encodeFlexKeySignatureUmp({ root: 0, scale: 661 })
		expect(packet).toEqual([0xd0100005, 0x80000000, 0, 0])
		const adapter = new FlexDataHarmonyAdapter({ coalesceMs: 0 })
		adapter.feed(packet)
		expect(adapter.state).toMatchObject({ root: 0, scale: 2741, keySignature: { sharpsOrFlats: -8, tonic: 0 } })
		expect(encodeFlexKeySignatureUmp(adapter.state)).toEqual(packet)
		adapter.destroy()
	})
	it("clears chords and old slash bass, rejects malformed/reserved data, and represents pedal chords correctly", () => {
		const adapter = new FlexDataHarmonyAdapter({ coalesceMs: 0 })
		adapter.feed(encodeFlexChordNameUmp({ root: 0, chord: 145, bass: 4 }))
		adapter.feed([0xd0100006, 0x070d0000, 0, 0x80000000]) // G7, default root bass
		expect(adapter.state).toMatchObject({ root: 0, chordRoot: 7, chord: 2212 })
		expect(adapter.state.bass).toBeUndefined()
		adapter.feed([0xd0100006, 0, 0, 0x80000000])
		expect(adapter.state.chord).toBe(0)
		expect(adapter.chordName).toBe("N.C.")
		expect(decodeFlexDataUmp([0xd0100006, 0x03170000, 0, 0x80000000])).toMatchObject({ chord: 1 })
		for (const packet of [[0xd0100006, 0x031c0000, 0, 0x80000000], [0xd0100006, 0x03010000, 1, 0x80000000], [0xd0300005, 0, 0, 0], [0xd0100005, NaN, 0, 0]]) expect(decodeFlexDataUmp(packet)).toBeUndefined()
		adapter.destroy()
	})
	it("retains symbols and bass-chord alterations through project persistence and exact re-encoding", () => {
		const packet = [0xd0100006, 0xf4033500, 0, 0x05071200] // Dbmaj7#5 / E minor(add2)
		const adapter = new FlexDataHarmonyAdapter({ coalesceMs: 0 })
		adapter.feed(packet)
		const tools = parseMusicTools(JSON.parse(JSON.stringify({ ...defaultMusicTools(), harmony: adapter.state })))
		expect(encodeFlexChordNameUmp(tools.harmony)).toEqual(packet)
		expect(sameHarmony(adapter.state, tools.harmony)).toBe(true)
		expect(() => parseHarmony({ ...tools.harmony, chordRoot: 12 })).toThrow()
		adapter.destroy()
	})
	it("encodes altered custom chords exactly or reports an unrepresentable pitch set", () => {
		for (const chord of [17, 149, 273, 1169, 153, 1173]) {
			try {
				const packet = encodeFlexChordNameUmp({ root: 0, chord })
				expect(decodeFlexDataUmp(packet)).toMatchObject({ chord })
			} catch (error) {
				expect(String(error)).toContain("cannot be represented exactly")
			}
		}
	})
	it("filters groups/channels and cancels scheduled and coalesced updates on reset", () => {
		vi.useFakeTimers()
		const changed = vi.fn()
		const adapter = new FlexDataHarmonyAdapter({ coalesceMs: 50, group: 2, channel: 4, onHarmony: changed, now: () => Date.now() })
		const packet = encodeFlexChordNameUmp({ root: 5, chord: 545 }, { group: 2, groupScoped: false, channel: 4 })
		expect(adapter.feed(encodeFlexChordNameUmp({ root: 0, chord: 145 }))).toBeUndefined()
		expect(adapter.feed(encodeFlexChordNameUmp({ root: 0, chord: 145 }, { group: 2, groupScoped: false, channel: 3 }))).toBeUndefined()
		adapter.feed(packet, Date.now() + 100)
		vi.advanceTimersByTime(99)
		expect(changed).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(changed).toHaveBeenCalledTimes(1) // Timestamped updates have no extra 50 ms latency.
		adapter.feed(packet)
		adapter.feed(packet, Date.now() + 100)
		adapter.reset()
		vi.advanceTimersByTime(200)
		expect(changed).toHaveBeenCalledTimes(1)
		adapter.destroy()
	})
	it("preserves 16-bit attack/release velocity and 32-bit expression while remapping note addresses", () => {
		const track = new TransformerChordTrack({ source: "live", mapping: "white-keys", follow: "chord" })
		const on = umpToCommand([0x42933e00, 0x91230000], 0, "keys")!
		const attack = track.transform([on], clock())[0]
		expect(commandToUmp(attack)).toEqual([0x42934000, 0x91230000])
		for (const words of [[0x42633e00, 0x81234567], [0x42133e4a, 0x12345678], [0x42a33e00, 0x23456789]]) {
			const expression = umpToCommand(words, 0, "keys")!
			const mapped = track.transform([expression], clock())[0]
			expect(commandToUmp(mapped)).toEqual([((words[0] & 0xffff00ff) | (64 << 8)) >>> 0, words[1]])
		}
		const off = umpToCommand([0x42833e00, 0x43210000], 1, "keys")!
		expect(commandToUmp(track.transform([off], clock(1))[0])).toEqual([0x42834000, 0x43210000])
	})
	it("keeps MIDI groups independent for held-note releases and leaves free parts untouched", () => {
		const track = new TransformerChordTrack({ source: "live", mapping: "white-keys", repitch: 1 })
		const on = (group: number) => umpToCommand([(0x40903e00 | group << 24) >>> 0, 0x91230000], 0, "keys")!
		track.transform([on(0), on(1)], clock())
		const off = umpToCommand([0x41803e00, 0], 1, "keys")!
		expect(track.transform([off], clock(1))[0].midiGroup).toBe(1)
		track.setHarmony({ root: 0, scale: 2741, chord: 529, chordRoot: 9 })
		// D maps to the common E, which is retained in the other group.
		expect(track.tick(2, clock(2))).toEqual([])
		const free = new TransformerChordTrack({ source: "live", follow: "free" })
		expect(free.transform([cmd(61)], clock())[0].number).toBe(61)
	})
	it("moves attribute pitch with a remapped note and preserves its fractional tuning", () => {
		const track = new TransformerChordTrack({ source: "live", mapping: "white-keys" })
		const on = umpToCommand([0x40903e03, (0x91230000 | (62 * 512 + 128)) >>> 0], 0, "keys")!
		const output = commandToUmp(track.transform([on], clock())[0])
		expect(output[1] >>> 16).toBe(0x9123)
		expect(output[1] & 65535).toBe(64 * 512 + 128)
	})
})

describe("Flex musical timing", () => {
	it("decodes independent time signature and metronome fixtures and persists the shared timing", () => {
		const meter = { numerator: 6, denominator: 8, thirtySecondNotes: 8 }
		const metronome = { clocksPerClick: 36, barAccents: [2, 0, 0] as [number, number, number], subdivisions: [3, 0] as [number, number] }
		expect(encodeFlexTimeSignatureUmp(meter)).toEqual([0xd0100001, 0x06030800, 0, 0])
		expect(encodeFlexMetronomeUmp(metronome)).toEqual([0xd0100002, 0x24020000, 0x03000000, 0])
		const onTimeSignature = vi.fn(), onMetronome = vi.fn()
		const adapter = new FlexDataHarmonyAdapter({ onTimeSignature, onMetronome })
		adapter.feed([0xd0100001, 0x06030800, 0, 0])
		adapter.feed([0xd0100002, 0x24020000, 0x03000000, 0])
		expect(onTimeSignature).toHaveBeenCalledWith(expect.objectContaining(meter))
		expect(onMetronome).toHaveBeenCalledWith(expect.objectContaining(metronome))
		const timing = { timeSignature: meter, metronome }
		expect(parseMusicTools({ ...defaultMusicTools(), timing }).timing).toEqual(timing)
		expect(harmonyMetronomeClicks(0, 3, timing).map(c => [c.at, c.accent, c.secondary])).toEqual([
			[0, true, false], [0.5, false, true], [1, false, true], [1.5, false, false], [2, false, true], [2.5, false, true]
		])
		adapter.destroy()
	})
})
