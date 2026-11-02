// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from "vitest"
import {
	TreeModel,
	branchPoint,
	branchPathPoint,
	branchHeight,
	TREE_FORK_HEIGHT
} from "../../../packages/audiobus/io/outputs/tree-model"
import OutputSongTree from "../../../packages/audiobus/io/outputs/output-song-tree"
import { createTreeRenderer } from "../../../packages/audiobus/io/outputs/tree-renderer"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands"

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("song tree growth", () => {
	it("turns every fork into an exactly vertical stem with smooth endpoint tangents", () => {
		const tree = new TreeModel()
		for (const note of [64, 67, 72, 76, 79]) {
			tree.noteOn(note, 110, 1, 0)
		}
		for (const branch of tree.branches) {
			expect(branchPathPoint(branch, 0)).toEqual(branch.origin)
			expect(branchPathPoint(branch, TREE_FORK_HEIGHT).x).toBe(branch.targetX)
			expect(branchPathPoint(branch, 100).x).toBe(branch.targetX)
			expect(branchPathPoint(branch, TREE_FORK_HEIGHT - 0.001).x).toBeCloseTo(
				branch.targetX,
				5
			)
		}
	})
	it("reserves non-overlapping vertical lanes in dense, polyphonic passages", () => {
		const tree = new TreeModel()
		for (let group = 0; group < 30; group++) {
			const at = group * 0.09
			for (const interval of [0, 4, 7, 11]) {
				tree.noteOn(48 + (group % 12) + interval, 127, 1 + (group % 4), at)
			}
		}
		tree.allNotesOff(4)
		const branches = tree.branches
		for (let i = 0; i < branches.length; i++) {
			for (let j = i + 1; j < branches.length; j++) {
				const a = branches[i],
					b = branches[j]
				const low = Math.max(a.origin.y, b.origin.y) + TREE_FORK_HEIGHT
				const high = Math.min(branchPoint(a, 4).y, branchPoint(b, 4).y)
				if (low < high) {
					expect(Math.abs(a.targetX - b.targetX)).toBeGreaterThan(12)
				}
			}
		}
	})
	it("routes curved forks without crossing unrelated stems", () => {
		const tree = new TreeModel()
		for (let group = 0; group < 10; group++) {
			for (const interval of [0, 4, 7, 11]) {
				tree.noteOn(48 + (group % 12) + interval, 127, (group % 3) + 1, group * 0.09)
			}
		}
		tree.allNotesOff(2)
		const branches = tree.branches
		for (const fork of branches) {
			let a = branchPathPoint(fork, 0)
			for (let step = 1; step <= 24; step++) {
				const b = branchPathPoint(fork, (TREE_FORK_HEIGHT * step) / 24)
				for (const stem of branches) {
					if (stem === fork || stem.id === fork.parent) {
						continue
					}
					if ((stem.targetX - a.x) * (stem.targetX - b.x) >= 0) {
						continue
					}
					const y = a.y + ((b.y - a.y) * (stem.targetX - a.x)) / (b.x - a.x)
					expect(y > stem.origin.y + TREE_FORK_HEIGHT && y < branchPoint(stem, 2).y).toBe(
						false
					)
				}
				a = b
			}
		}
	})
	it("reuses lane space for disjoint passages and keeps even very short notes visible", () => {
		const tree = new TreeModel()
		for (let i = 0; i < 120; i++) {
			tree.noteOn(60, 70, 1, i * 2)
			tree.noteOff(60, 1, i * 2 + 0.001)
		}
		for (const branch of tree.branches) {
			expect(Math.abs(branch.targetX)).toBeLessThan(26)
			expect(branchHeight(branch, 300)).toBeGreaterThan(TREE_FORK_HEIGHT)
		}
	})
	it("uses onset gaps to vary shoot spacing while keeping long rests compact", () => {
		function secondShoot(gap: number) {
			const tree = new TreeModel()
			tree.noteOn(60, 80, 1, 0)
			tree.allNotesOff(0.02)
			tree.noteOn(60, 80, 1, gap)
			const branch = tree.branches[1]
			return { branch, tip: branchPoint(branch, gap + 2) }
		}
		const rapid = secondShoot(0.08),
			relaxed = secondShoot(0.8),
			rest = secondShoot(100)
		expect(Math.abs(rapid.tip.x)).toBeLessThan(Math.abs(relaxed.tip.x))
		expect(relaxed.branch.spread).toBeLessThan(rest.branch.spread)
		expect(rest.branch.spread).toBeLessThanOrEqual(40)
		expect(secondShoot(0.8).tip).toEqual(relaxed.tip)
	})
	it("shares timing-based spacing within chords and restores it after planting a new tree", () => {
		const tree = new TreeModel()
		const playChord = (at: number) => {
			for (const note of [60, 64, 67]) {
				tree.noteOn(note, 80, 1, at)
			}
		}
		playChord(0)
		const initial = tree.branches.map((branch) => branch.spread)
		tree.allNotesOff(0.01)
		playChord(0.08)
		const quick = tree.branches.slice(3)
		const ratios = quick.map((branch) => branch.spread / (40 + (branch.note % 12) * 1.5))
		expect(ratios[0]).toBeCloseTo(ratios[1])
		expect(ratios[1]).toBeCloseTo(ratios[2])
		expect(quick[0].spread).toBeLessThan(initial[0])
		tree.reset()
		playChord(10)
		expect(tree.branches.map((branch) => branch.spread)).toEqual(initial)
	})
	it("never sprouts a new chord from a released branch, including notes in the grouping window", () => {
		const tree = new TreeModel()
		for (const note of [60, 64, 67]) {
			tree.noteOn(note, 90, 1, 0)
		}
		tree.allNotesOff(0.5)
		const frozen = tree.branches.map((branch) => branchHeight(branch, 0.5))
		for (const note of [65, 69, 72]) {
			tree.noteOn(note, 90, 1, 0.6)
		}
		const root = tree.branches.find((branch) => branch.note === 65)!
		expect(root.parent).toBeUndefined()
		expect(tree.branches.slice(0, 3).map((branch) => branchHeight(branch, 2))).toEqual(frozen)
		tree.allNotesOff(0.61)
		tree.noteOn(62, 90, 1, 0.62)
		expect(tree.branches.at(-1)!.parent).toBeUndefined()
	})
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
			expect(child.origin.x).toBe(root.targetX)
			expect(child.targetX).not.toBe(root.targetX)
			expect(branchPoint(child, 1)).not.toEqual(branchPoint(root, 1))
		}
	})
	it("interlocks chord progressions and alternates independent roots", () => {
		const tree = new TreeModel()
		for (const note of [60, 64, 67]) {
			tree.noteOn(note, 90, 1, 0)
		}
		const first = tree.branches.find((branch) => branch.parent === undefined)!
		for (const note of [65, 69, 72]) {
			tree.noteOn(note, 90, 1, 1)
		}
		const second = tree.branches.find((branch) => branch.note === 65)!
		expect(second.parent).toBe(first.id)
		expect(second.origin.x).toBe(first.targetX)
		expect(second.origin.y).toBeLessThanOrEqual(branchPoint(first, 1).y)
		expect(second.side).toBe(first.side)
		tree.allNotesOff(2)
		tree.noteOn(62, 70, 1, 8)
		const independent = tree.branches.at(-1)!
		expect(independent.parent).toBeUndefined()
		expect(independent.origin.x).toBe(0)
		expect(independent.side).toBe(-second.side)
	})
	it("keeps channel identities, treats zero velocity as release, and retains complete song history", () => {
		const tree = new TreeModel()
		tree.noteOn(60, 30, 1, 0)
		tree.noteOn(60, 127, 2, 0)
		tree.noteOn(60, 0, 1, 1)
		expect([...tree.held.keys()]).toEqual(["2:60"])
		for (let i = 1; i <= 1300; i++) {
			tree.noteOn(62, 90, 1, i)
			tree.noteOff(62, 1, i + 0.2)
		}
		expect(tree.branches.length).toBe(1302)
		expect(tree.held.has("2:60")).toBe(true)
		tree.reset()
		expect(tree.branches).toEqual([])
		expect(tree.started).toBeUndefined()
	})
})

describe("song tree output and renderer", () => {
	it("brings any historical branch into view at a readable scale", () => {
		let now = 0
		const output = new OutputSongTree({ now: () => now })
		for (let i = 0; i < 100; i++) {
			now = i
			output.noteOn(48 + (i % 24), 100)
			now += 0.2
			output.allNotesOff()
		}
		Object.assign(output, {
			canvas: document.createElement("canvas"),
			renderer: { backend: "Canvas", draw: vi.fn(), destroy: vi.fn() },
			scale: 0.01,
			viewMode: "fit"
		})
		for (const index of [0, 50, 99]) {
			;(output as any).focusBranch(index)
			const branch = output.model.branches[index]
			expect((output as any).selectedBranch).toBe(branch)
			expect((output as any).scale).toBeGreaterThanOrEqual(1)
			expect((output as any).cameraX).toBe(branch.targetX)
			expect((output as any).cameraY).toBe(branch.origin.y + branchHeight(branch, now) / 2)
		}
		output.destroy()
	})
	function flashScene() {
		let now = 0
		const output = new OutputSongTree({ now: () => now })
		let colors: number[][] = []
		Object.assign(output, {
			canvas: document.createElement("canvas"),
			renderer: {
				backend: "Canvas",
				destroy: vi.fn(),
				draw(data: Float32Array, count: number) {
					colors = []
					for (let i = 0; i < count * 12; i += 12) {
						if (
							data[i + 8] === 0 &&
							data[i] === data[i + 2] &&
							data[i + 1] !== data[i + 3] &&
							Math.abs(
								data[i] - (240 - (output as any).cameraX * (output as any).scale)
							) > 0.01
						) {
							colors.push(Array.from(data.slice(i + 5, i + 8)))
						}
					}
				}
			}
		})
		output.noteOn(60, 80)
		now = 0.2
		output.allNotesOff()
		now = 0.3
		output.noteOn(64, 80)
		now = 0.5
		output.allNotesOff()
		return {
			output,
			render(time: number) {
				now = time
				;(output as any).draw(now)
				return colors.slice(-2)
			},
			setTime(time: number) {
				now = time
			}
		}
	}
	it("flashes every existing branch on a note trigger and fades back to each pitch's original colour", () => {
		const scene = flashScene()
		const regular = scene.render(3)
		scene.output.sendCommand(
			musicalCommand({ type: NOTE_ON, number: 67, velocity: 127, channel: 2 })
		)
		const peak = scene.render(3)
		expect(peak).toHaveLength(2)
		for (let leaf = 0; leaf < regular.length; leaf++) {
			for (let color = 0; color < 3; color++) {
				expect(peak[leaf][color]).toBeGreaterThan(regular[leaf][color])
			}
		}
		const fading = scene.render(3.5)
		expect(fading[0][0]).toBeLessThan(peak[0][0])
		expect(fading[0][0]).toBeGreaterThan(regular[0][0])
		expect(scene.render(5)).toEqual(regular)
		scene.output.destroy()
	})
	it("makes harder notes brighter and longer, preserving their fade through softer retriggers", () => {
		const soft = flashScene(),
			hard = flashScene()
		const regular = soft.render(3)
		hard.render(3)
		soft.output.noteOn(67, 20)
		hard.output.noteOn(67, 127)
		expect(hard.render(3)[0][0]).toBeGreaterThan(soft.render(3)[0][0])
		hard.setTime(3.1)
		hard.output.noteOn(69, 20)
		expect(soft.render(3.5)).toEqual(regular)
		expect(hard.render(3.5)[0][0]).toBeGreaterThan(regular[0][0])
		expect(hard.render(5)).toEqual(regular)
		soft.output.destroy()
		hard.output.destroy()
	})
	it("does not flash on releases, invalid notes, or disconnected input", async () => {
		const scene = flashScene(),
			regular = scene.render(3)
		scene.output.noteOn(60, 0)
		scene.output.noteOn(128, 127)
		scene.output.noteOn(60, NaN)
		scene.output.noteOff(60)
		expect(scene.render(3)).toEqual(regular)
		await scene.output.disconnect()
		scene.output.noteOn(60, 127)
		scene.output.sendCommand(
			musicalCommand({ type: NOTE_ON, number: 60, velocity: 127, channel: 1 })
		)
		expect(scene.render(3)).toEqual(regular)
		scene.output.destroy()
	})
	it("fits every branch of a long song without truncating GPU batches, and supports zooming back in", () => {
		let now = 0
		const output = new OutputSongTree({ now: () => now })
		for (let i = 0; i < 8500; i++) {
			now = i * 0.1
			output.noteOn(60 + (i % 12), 80)
			now += 0.08
			output.allNotesOff()
		}
		let stems = 0
		let checkFit = true
		const appends: boolean[] = []
		const renderer = {
			backend: "Canvas",
			destroy: vi.fn(),
			draw(
				data: Float32Array,
				count: number,
				width: number,
				height: number,
				append: boolean
			) {
				appends.push(append)
				for (let i = 0; i < count * 12; i += 12) {
					if (
						data[i + 8] === 0 &&
						data[i] === data[i + 2] &&
						data[i + 1] !== data[i + 3] &&
						Math.abs(
							data[i] - (width / 2 - (output as any).cameraX * (output as any).scale)
						) > 0.01
					) {
						stems++
						if (checkFit) {
							expect(data[i]).toBeGreaterThan(0)
							expect(data[i + 1]).toBeGreaterThan(0)
							expect(data[i + 2]).toBeLessThan(width)
							expect(data[i + 3]).toBeLessThan(height)
						}
					}
				}
			}
		}
		Object.assign(output, {
			renderer,
			canvas: document.createElement("canvas"),
			viewMode: "fit"
		})
		;(output as any).draw(now)
		expect(stems).toBe(8500)
		expect(appends[0]).toBe(false)
		expect(appends.length).toBeGreaterThan(1)
		expect(appends.slice(1).every(Boolean)).toBe(true)
		const fitScale = (output as any).scale
		expect(fitScale).toBeLessThan(0.02)
		checkFit = false
		;(output as any).zoomBy(1.4)
		expect((output as any).scale).toBeCloseTo(fitScale * 1.4)
		expect((output as any).viewMode).toBe("manual")
		output.destroy()
	})
	it("keeps releases bare, retains velocity widths and lets the trunk continue growing", () => {
		let now = 0
		const output = new OutputSongTree({ now: () => now })
		let frame = new Float32Array()
		Object.assign(output, {
			canvas: document.createElement("canvas"),
			renderer: {
				backend: "Canvas",
				destroy: vi.fn(),
				draw(data: Float32Array, count: number) {
					frame = data.slice(0, count * 12)
				}
			}
		})
		output.noteOn(60, 30)
		output.noteOn(67, 127)
		now = 1
		output.allNotesOff()
		;(output as any).draw(now)
		const stemRadii: number[] = []
		for (let i = 0; i < frame.length; i += 12) {
			expect(frame[i + 8]).toBe(0)
			if (frame[i] === frame[i + 2] && frame[i] !== 240 && frame[i + 1] !== frame[i + 3]) {
				stemRadii.push(frame[i + 4])
			}
		}
		expect(stemRadii).toHaveLength(2)
		expect(stemRadii[0]).toBeGreaterThan(stemRadii[1])
		const trunkEnd = frame[15]
		now = 2
		;(output as any).draw(now)
		expect(frame[15]).toBeLessThan(trunkEnd)
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