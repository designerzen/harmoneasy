// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import IOChainManager from "../../../packages/audiobus/io/IO-chain-manager"
import IOChain from "../../../packages/audiobus/io/IO-chain"
import { mountHarmonyWorkspace } from "../source/services/harmony-workspace"
import { mountDawBridge } from "../source/services/harmony-daw"
import { INPUT_EVENT, NOTE_ON } from "../../../packages/audiobus/commands"
import { encodeOSC, decodeOSC } from "../../../packages/audiobus/io/osc"
import { defaultMusicTools } from "../../../packages/audiobus/io/music-tools"

const cleanup: Array<() => void> = []
afterEach(() => {
	cleanup
		.splice(0)
		.reverse()
		.forEach((fn) => fn())
	document.body.replaceChildren()
	vi.unstubAllGlobals()
})
function setup() {
	const timer = { now: 0, BPM: 120, isRunning: false } as any
	const manager = new IOChainManager({ timer, outputMixer: {} as GainNode })
	const chain = new IOChain(timer)
	chain.setTransformers([])
	manager.addChain(chain, "keys")
	cleanup.push(() => manager.destroy())
	return manager
}
function button(host: ParentNode, name: string) {
	return [...host.querySelectorAll("button")].find((b) => b.textContent === name)!
}
function input(host: ParentNode, label: string) {
	return [...host.querySelectorAll("label")]
		.find((l) => l.textContent?.startsWith(label))!
		.querySelector("input")!
}

describe("harmony workspace", () => {
	it("saves and recalls scale/chord pairs, adds a follower, renders tablature and adopts inferred scales", async () => {
		const manager = setup()
		const mounted = mountHarmonyWorkspace(
			manager,
			{ resume: vi.fn() } as any,
			() => 120,
			() => {}
		)
		cleanup.push(() => mounted.destroy())
		const dialog = document.querySelector(".harmony-workspace")!
		manager.setHarmony({ root: 2, scale: 2774, chord: 580 })
		button(dialog, "Save current harmony as section").click()
		await vi.waitFor(() => expect(manager.musicTools.sections).toHaveLength(1))
		manager.setHarmony({ root: 0, scale: 2741, chord: 145 })
		button(dialog, "Recall").click()
		expect(manager.harmony).toEqual({ root: 2, scale: 2774, chord: 580 })
		button(dialog, "Add live harmony follower to selected chain").click()
		expect(manager.activeChain!.transformers).toHaveLength(1)
		expect(dialog.querySelectorAll(".harmony-network button").length).toBeGreaterThan(10)
		expect(dialog.querySelector(".harmony-fretboard pre")?.textContent).toContain("|--")
		const listen = input(dialog, "Collect notes from selected chain")
		listen.checked = true
		for (const number of [60, 62, 64, 65, 67, 69, 71]) {
			manager.dispatchEvent(
				new CustomEvent(INPUT_EVENT, {
					detail: { chainId: "keys", command: { type: NOTE_ON, number, velocity: 90 } }
				})
			)
		}
		await vi.waitFor(() =>
			expect(
				[...dialog.querySelectorAll("button")].some((b) =>
					b.textContent?.startsWith("C Major ·")
				)
			).toBe(true)
		)
		;[...dialog.querySelectorAll("button")]
			.find((b) => b.textContent?.startsWith("C Major ·"))!
			.click()
		expect(manager.harmony.scale).toBe(2741)
		const play = input(dialog, "Follow sections with transport")
		play.checked = true
		play.dispatchEvent(new Event("change"))
		manager.updateMusicalBeat(0)
		expect(manager.harmony.scale).toBe(2774)
	})
})

class Socket extends EventTarget {
	static OPEN = 1
	static current: Socket
	readyState = 1
	binaryType = ""
	send = vi.fn()
	close = vi.fn()
	constructor(_url: string) {
		super()
		Socket.current = this
	}
}
describe("DAW harmonic bridge", () => {
	it("exchanges OSC state, recalls sections and prevents an incoming state echo", () => {
		vi.stubGlobal("WebSocket", Socket)
		const manager = setup(),
			host = document.createElement("div"),
			tempo = vi.fn()
		const bridge = mountDawBridge(host, manager, () => 120, tempo)
		cleanup.push(() => bridge.destroy())
		button(host, "Connect DAW bridge").click()
		const socket = Socket.current
		socket.dispatchEvent(new Event("open"))
		button(host, "Send this session to DAW").click()
		expect(socket.send).toHaveBeenCalledTimes(2)
		const packets = socket.send.mock.calls.map(([packet]) => decodeOSC(packet)[0])
		expect(packets.map((p) => p.address)).toEqual(["/harmoneasy/project", "/harmoneasy/state"])
		input(host, "Follow DAW tempo").checked = true
		const deliver = (address: string, args: Array<string | number>) => {
			const packet = encodeOSC({ address, args })
			socket.dispatchEvent(new MessageEvent("message", { data: packet.buffer }))
		}
		deliver("/harmoneasy/state", [2, 2774, 580, 130])
		expect(manager.harmony).toEqual({ root: 2, scale: 2774, chord: 580 })
		expect(tempo).toHaveBeenCalledWith(130)
		expect(socket.send).toHaveBeenCalledTimes(2)
		const tools = defaultMusicTools()
		tools.sections = [{ ...tools.harmony, id: "a", name: "Verse", beats: 8, x: 0.5, y: 0.5 }]
		deliver("/harmoneasy/project", [JSON.stringify(tools)])
		expect(manager.musicTools.sections[0].name).toBe("Verse")
		expect(socket.send).toHaveBeenCalledTimes(2)
		deliver("/harmoneasy/state", [99, 1, 1, 120])
		expect(manager.harmony.root).toBe(0)
		expect(host.textContent).toContain("Harmony needs a tonic")
	})
})