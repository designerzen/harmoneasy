// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from "vitest"
import { TreeModel, branchPoint } from "../../../packages/audiobus/io/outputs/tree-model"
import OutputSongTree from "../../../packages/audiobus/io/outputs/output-song-tree"
import { createTreeRenderer } from "../../../packages/audiobus/io/outputs/tree-renderer"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("song tree growth", () => {
	it("starts on the first note, preserves velocity, and freezes released branches", () => {
		const tree = new TreeModel()
		expect(tree.started).toBeUndefined()
		tree.noteOn(60, 100, 1, 2)
		const branch = tree.branches[0]
		expect(tree.started).toBe(2)
		expect(branch.velocity).toBe(100)
		expect(branchPoint(branch, 3).y).toBeGreaterThan(branchPoint(branch, 2.5).y)
		tree.noteOff(60, 1, 3)
		expect(branchPoint(branch, 30)).toEqual(branchPoint(branch, 3))
		expect(tree.held.size).toBe(0)
	})
	it("recognizes an inverted chord regardless of note arrival order and forks from its root", () => {
		const tree = new TreeModel()
		for (const note of [64, 67, 72]) {
			tree.noteOn(note, 90, 1, 0)
		}
		const root = tree.branches.find((branch) => branch.note === 72)!
		expect(root.parent).toBeUndefined()
		for (const child of tree.branches.filter((branch) => branch !== root)) {
			expect(child.parent).toBe(root.id)
			expect(child.stem).toBe(root)
			expect(branchPoint(child, 0.1)).toEqual(branchPoint(root, 0.1))
			expect(branchPoint(child, 1)).not.toEqual(branchPoint(root, 1))
		}
	})
	it("interlocks chord progressions and alternates independent roots", () => {
		const tree = new TreeModel()
		for (const note of [60, 64, 67]) {
			tree.noteOn(note, 90, 1, 0)
		}
		const first = tree.branches.find((branch) => branch.parent === undefined)!
		tree.allNotesOff(0.8)
		for (const note of [65, 69, 72]) {
			tree.noteOn(note, 90, 1, 1)
		}
		const second = tree.branches.find((branch) => branch.note === 65)!
		expect(second.parent).toBe(first.id)
		expect(second.origin).toEqual(branchPoint(first, 1))
		expect(second.side).toBe(-first.side)
		tree.allNotesOff(2)
		tree.noteOn(62, 70, 1, 8)
		const independent = tree.branches.at(-1)!
		expect(independent.parent).toBeUndefined()
		expect(independent.origin.x).toBe(0)
		expect(independent.side).toBe(-second.side)
	})
	it("keeps channel identities, treats zero velocity as release, and bounds history", () => {
		const tree = new TreeModel()
		tree.noteOn(60, 30, 1, 0)
		tree.noteOn(60, 127, 2, 0)
		tree.noteOn(60, 0, 1, 1)
		expect([...tree.held.keys()]).toEqual(["2:60"])
		for (let i = 1; i <= 1300; i++) {
			tree.noteOn(62, 90, 1, i)
			tree.noteOff(62, 1, i + 0.2)
		}
		expect(tree.branches.length).toBeLessThanOrEqual(1024)
		expect(tree.held.has("2:60")).toBe(true)
		tree.reset()
		expect(tree.branches).toEqual([])
		expect(tree.started).toBeUndefined()
	})
})

describe("song tree output and renderer", () => {
	it("adds velocity-sized matching leaves on release while the trunk continues growing", () => {
		let now = 0
		const output = new OutputSongTree({ now: () => now })
		const frames: Float32Array[] = []
		const renderer = {
			backend: "Canvas",
			destroy: vi.fn(),
			draw: (data: Float32Array, count: number) => frames.push(data.slice(0, count * 12))
		}
		Object.assign(output, { renderer, canvas: document.createElement("canvas") })
		const draw = () => (output as any).draw(now)
		output.noteOn(60, 30)
		output.noteOn(67, 127)
		now = 1
		draw()
		expect(
			Array.from(frames.at(-1)!)
				.filter((_, index) => index % 12 === 8)
				.every((value) => value === 0)
		).toBe(true)
		output.allNotesOff()
		draw()
		const released = frames.at(-1)!,
			leaves: Float32Array[] = []
		for (let index = 0; index < released.length; index += 12) {
			if (released[index + 8] === 1) {
				leaves.push(released.slice(index, index + 12))
			}
		}
		expect(leaves).toHaveLength(2)
		expect(leaves[0][4]).toBeGreaterThan(leaves[1][4])
		expect(Array.from(leaves[0].slice(5, 8))).toEqual(Array.from(released.slice(29, 32)))
		const trunkEnd = released[15]
		now = 2
		draw()
		expect(frames.at(-1)![15]).toBeLessThan(trunkEnd)
		output.destroy()
	})
	it("routes channel-aware commands and ignores input after disconnect", async () => {
		let now = 0
		const output = new OutputSongTree({ now: () => now })
		output.sendCommand(musicalCommand({ type: NOTE_ON, number: 60, velocity: 100, channel: 2 }))
		now = 1
		output.sendCommand(musicalCommand({ type: NOTE_OFF, number: 60, velocity: 0, channel: 1 }))
		expect(output.model.held.size).toBe(1)
		await output.disconnect()
		expect(output.model.branches[0].end).toBe(1)
		output.noteOn(62, 100)
		expect(output.model.branches.length).toBe(1)
		output.destroy()
	})
	it("maps scheduled transport beats to animation time rather than callback time", () => {
		const output = new OutputSongTree({ now: () => 10, audioContext: { currentTime: 2 } })
		output.onClockTick({ step: 5, bpm: 120, triggerAt: 2.2, stepDuration: 0.125 })
		expect((output as any).beatAnchor).toBeCloseTo(10.075)
		expect((output as any).beatPeriod).toBe(0.5)
		output.destroy()
	})
	it("falls back to a fresh Canvas context after GPU adapter rejection", async () => {
		vi.stubGlobal("navigator", {
			gpu: { requestAdapter: vi.fn().mockRejectedValue(new Error("Unavailable")) }
		})
		const context = { setTransform: vi.fn(), fillRect: vi.fn() }
		const canvases: any[] = []
		const result = await createTreeRenderer(() => {
			const canvas = {
				getContext: vi.fn((type: string) => (type === "2d" ? context : null)),
				width: 480,
				height: 420
			}
			canvases.push(canvas)
			return canvas as unknown as HTMLCanvasElement
		})
		expect(result.renderer.backend).toBe("Canvas")
		expect(canvases).toHaveLength(3)
		result.renderer.draw(new Float32Array(12), 0, 480, 420)
		expect(context.fillRect).toHaveBeenCalledWith(0, 0, 480, 420)
		result.renderer.destroy()
		vi.unstubAllGlobals()
	})
})