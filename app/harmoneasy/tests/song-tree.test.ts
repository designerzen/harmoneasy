// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from "vitest"
import {
	TreeModel,
	branchArcPoint,
	branchPathPoint,
	branchLimit,
	leafLength,
	type TreeBranch
} from "../../../packages/audiobus/io/outputs/tree-model"
import OutputSongTree from "../../../packages/audiobus/io/outputs/output-song-tree"
import { createTreeRenderer } from "../../../packages/audiobus/io/outputs/tree-renderer"
import { musicalCommand } from "../../../packages/audiobus/io/event-clip"
import { NOTE_ON, NOTE_OFF } from "../../../packages/audiobus/commands/commands"

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

/** Three independent voices: sustained chords, a syncopated lead and a bass line. */
function denseSong(): TreeModel {
	const tree = new TreeModel()
	const events: Array<{ at: number; note: number; channel: number; on: boolean }> = []
	const play = (at: number, note: number, duration: number, channel: number) =>
		events.push(
			{ at, note, channel, on: true },
			{ at: at + duration, note, channel, on: false }
		)
	for (let bar = 0; bar < 24; bar++) {
		const base = [48, 45, 53, 43, 50][bar % 5],
			at = bar * 2.2
		;[0, 4, 7, 11].forEach((interval, index) =>
			play(at, base + interval, bar % 3 ? 1.7 + index * 0.1 : 2.4, 1)
		)
		;[0, 0.12, 0.31, 0.55, 0.64, 1.02, 1.15, 1.49, 1.8].forEach((offset, index) =>
			play(
				at + offset,
				base + 12 + [0, 7, 4, 11, 14, 7, 16, 12, 9][index],
				0.25 + (index % 4) * 0.22,
				2
			)
		)
		;[0, 0.37, 1.12, 1.57].forEach((offset, index) =>
			play(at + offset, base - 12 + [0, 0, 7, 5][index], 0.6, 3)
		)
	}
	events.sort((a, b) => a.at - b.at || Number(a.on) - Number(b.on))
	for (const event of events) {
		if (event.on) {
			tree.noteOn(event.note, 90, event.channel, event.at)
		} else {
			tree.noteOff(event.note, event.channel, event.at)
		}
	}
	return tree
}
function playChord(tree: TreeModel, notes: number[], at: number): void {
	for (const note of notes) {
		tree.noteOn(note, 90, 1, at)
	}
}
const latest = (tree: TreeModel, note: number): TreeBranch =>
	tree.branches.findLast((branch) => branch.note === note)!

describe("song tree growth", () => {
	it("arcs every branch out of its parent and into an exactly vertical stem, without corners", () => {
		const tree = denseSong()
		for (const branch of tree.branches) {
			expect(branchPathPoint(branch, 0)).toEqual(branch.origin)
			expect(branchPathPoint(branch, branch.arc + 100).x).toBe(branch.targetX)
			if (!branch.arc) {
				expect(branch.origin.x).toBe(branch.targetX)
				continue
			}
			// The fork leaves along its parent and arrives along its own stem.
			const reach = Math.abs(branch.targetX - branch.origin.x)
			expect(Math.abs(branchArcPoint(branch, 0.01).x - branch.origin.x)).toBeLessThan(
				reach * 0.001
			)
			expect(Math.abs(branchArcPoint(branch, 0.99).x - branch.targetX)).toBeLessThan(
				reach * 0.001
			)
			let previous = branchArcPoint(branch, 0),
				heading = Math.PI / 2
			for (let step = 1; step <= 64; step++) {
				const point = branchArcPoint(branch, step / 64)
				const next = Math.atan2(point.y - previous.y, Math.abs(point.x - previous.x))
				expect(point.y).toBeGreaterThan(previous.y)
				expect(Math.abs(next - heading)).toBeLessThan(0.2)
				previous = point
				heading = next
			}
		}
	})
	it("never grows two branches in the same place, even in dense polyphonic passages", () => {
		const branches = denseSong().branches
		for (let i = 0; i < branches.length; i++) {
			for (let j = i + 1; j < branches.length; j++) {
				const a = branches[i],
					b = branches[j]
				if (a.continuedBy === b || Math.abs(a.targetX - b.targetX) >= 12) {
					continue
				}
				// The later branch only arrives in the lane above the earlier leaf.
				expect(b.origin.y + b.arc / 2).toBeGreaterThanOrEqual(
					branchLimit(a) + leafLength(a)
				)
			}
		}
	})
	it("never crosses a fork over another stem", () => {
		const branches = denseSong().branches
		for (const fork of branches) {
			let a = branchArcPoint(fork, 0)
			for (let step = 1; step <= 24; step++) {
				const b = branchArcPoint(fork, step / 24)
				for (const stem of branches) {
					if (stem === fork || stem === fork.parent || stem.side !== fork.side) {
						continue
					}
					if ((stem.targetX - a.x) * (stem.targetX - b.x) >= 0) {
						continue
					}
					const y = a.y + ((b.y - a.y) * (stem.targetX - a.x)) / (b.x - a.x)
					expect(y > stem.origin.y + stem.arc && y < branchLimit(stem)).toBe(false)
				}
				a = b
			}
		}
	})
	it("alternates single notes between the two sides of the trunk and reuses their space", () => {
		const tree = new TreeModel()
		for (let i = 0; i < 120; i++) {
			tree.noteOn(60 + (i % 5), 70, 1, i * 2)
			tree.noteOff(60 + (i % 5), 1, i * 2 + 0.001)
		}
		tree.branches.forEach((branch, index) => {
			expect(branch.parent).toBeUndefined()
			expect(branch.origin.x).toBe(0)
			expect(branch.side).toBe(index % 2 ? -1 : 1)
			expect(Math.abs(branch.targetX)).toBeLessThan(40)
			// Even the shortest note completes its arc and shows its leaf.
			expect(branchLimit(branch) - branch.origin.y).toBeCloseTo(branch.arc)
			expect(tree.tipY(branch, 300)).toBe(branchLimit(branch))
		})
	})
	it("uses onset gaps to vary spacing naturally while staying compact", () => {
		function second(gap: number): TreeBranch {
			const tree = new TreeModel()
			tree.noteOn(60, 80, 1, 0)
			tree.allNotesOff(0.02)
			tree.noteOn(60, 80, 1, gap)
			return tree.branches[1]
		}
		const rapid = second(0.08),
			relaxed = second(0.8),
			rest = second(100)
		expect(Math.abs(rapid.targetX)).toBeLessThan(Math.abs(relaxed.targetX))
		expect(Math.abs(relaxed.targetX)).toBeLessThan(Math.abs(rest.targetX))
		expect(Math.abs(rest.targetX) - Math.abs(rapid.targetX)).toBeLessThan(6)
		expect(second(0.8).targetX).toBe(relaxed.targetX)
		// Every note of a chord shares the spacing of its onset.
		const tree = new TreeModel()
		playChord(tree, [60, 64, 67], 0)
		const [root, third, fifth] = tree.branches
		expect(third.targetX - root.targetX).toBeCloseTo(fifth.targetX - third.targetX)
	})
	it("starts on the first note, grows held notes, freezes released ones and keeps the trunk growing", () => {
		const tree = new TreeModel()
		expect(tree.started).toBeUndefined()
		expect(tree.heightAt(1)).toBe(0)
		tree.noteOn(60, 100, 1, 2)
		const branch = tree.branches[0]
		expect(tree.started).toBe(2)
		expect(branch.velocity).toBe(100)
		expect(tree.tip(branch, 3).y).toBeGreaterThan(tree.tip(branch, 2.5).y)
		tree.noteOff(60, 1, 3)
		expect(tree.tip(branch, 30)).toEqual(tree.tip(branch, 3))
		expect(tree.heightAt(30)).toBeGreaterThan(tree.heightAt(3))
		expect(tree.held.size).toBe(0)
	})
	it("makes the chord root the main branch and grows the other notes from it, whatever the arrival order", () => {
		const tree = new TreeModel()
		playChord(tree, [64, 67, 72], 0)
		const root = latest(tree, 72)
		expect(root.parent).toBeUndefined()
		expect(root.origin.x).toBe(0)
		const forks = tree.branches.filter((branch) => branch !== root)
		for (const child of forks) {
			expect(child.parent).toBe(root)
			expect(child.side).toBe(root.side)
			expect(child.origin.y).toBeGreaterThan(root.origin.y)
			expect(child.origin.x).toBeCloseTo(
				branchPathPoint(root, child.origin.y - root.origin.y).x
			)
			expect(Math.abs(child.targetX)).toBeGreaterThan(Math.abs(root.targetX))
		}
		// The furthest sub-branch forks lowest, so siblings nest instead of crossing.
		const [near, far] = forks.sort((a, b) => Math.abs(a.targetX) - Math.abs(b.targetX))
		expect(far.origin.y).toBeLessThan(near.origin.y)
		// The whole chord unfurls with the surge that follows its onset.
		for (const branch of tree.branches) {
			expect(tree.heightAt(0.3)).toBeGreaterThan(branch.origin.y)
		}
	})
	it("carries a chord progression onwards along the same bough instead of starting new ones", () => {
		const tree = new TreeModel()
		playChord(tree, [60, 64, 67], 0)
		const first = latest(tree, 60)
		tree.allNotesOff(1)
		playChord(tree, [65, 69, 72], 1.1)
		const second = latest(tree, 65)
		expect(second.continues).toBe(first)
		expect(first.continuedBy).toBe(second)
		expect(second.side).toBe(first.side)
		expect(second.origin).toEqual({ x: first.targetX, y: branchLimit(first) })
		expect(second.targetX).toBe(first.targetX)
		// Its notes interlock with the finished chord: same lanes, above the old leaves.
		for (const [note, under] of [
			[69, 64],
			[72, 67]
		]) {
			const fork = latest(tree, note),
				below = latest(tree, under)
			expect(fork.parent).toBe(second)
			expect(fork.lane).toBe(below.lane)
			expect(fork.origin.y + fork.arc / 2).toBeGreaterThanOrEqual(
				branchLimit(below) + leafLength(below)
			)
		}
	})
	it("forks an overlapping chord change from the chord that is still sounding", () => {
		const tree = new TreeModel()
		playChord(tree, [60, 64, 67], 0)
		playChord(tree, [65, 69, 72], 1)
		const second = latest(tree, 65)
		expect(tree.branches.slice(0, 3)).toContain(second.parent)
		expect(second.origin.y).toBeLessThanOrEqual(tree.heightAt(1))
		expect(second.origin.x).toBe(second.parent!.targetX)
		expect(second.side).toBe(tree.branches[0].side)
		expect(Math.abs(second.targetX)).toBeGreaterThan(Math.abs(second.parent!.targetX))
	})
	it("never sprouts from a finished branch, and alternates sides for each new bough", () => {
		const tree = new TreeModel()
		playChord(tree, [60, 64, 67], 0)
		tree.allNotesOff(0.5)
		const frozen = tree.branches.map((branch) => tree.tipY(branch, 0.5))
		playChord(tree, [65, 69, 72], 1.5)
		const root = latest(tree, 65)
		expect(root.parent).toBeUndefined()
		expect(root.continues).toBeUndefined()
		expect(root.origin.x).toBe(0)
		expect(root.side).toBe(-tree.branches[0].side)
		expect(tree.branches.slice(0, 3).map((branch) => tree.tipY(branch, 9))).toEqual(frozen)
		tree.allNotesOff(1.6)
		// A single note after a chord is a new bough, not part of a progression.
		tree.noteOn(62, 90, 1, 1.62)
		expect(tree.branches.at(-1)!.parent).toBeUndefined()
		expect(tree.branches.at(-1)!.continues).toBeUndefined()
		expect(tree.branches.at(-1)!.side).toBe(-root.side)
	})
	it("grows a note from the outermost held branch when both sides of the trunk are taken", () => {
		const tree = new TreeModel()
		tree.noteOn(60, 90, 1, 0)
		tree.noteOn(62, 90, 1, 1)
		tree.noteOn(64, 90, 1, 2)
		const [right, left, fork] = tree.branches
		expect(right.side).toBe(-left.side)
		expect([right, left]).toContain(fork.parent)
		expect(Math.abs(fork.targetX)).toBeGreaterThan(Math.abs(fork.parent!.targetX))
		expect(fork.origin.y).toBeLessThanOrEqual(tree.heightAt(2))
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
		const fresh = new TreeModel()
		playChord(fresh, [60, 64, 67], 10)
		tree.reset()
		expect(tree.branches).toEqual([])
		expect(tree.started).toBeUndefined()
		playChord(tree, [60, 64, 67], 10)
		expect(tree.branches.map((branch) => branch.targetX)).toEqual(
			fresh.branches.map((branch) => branch.targetX)
		)
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
			expect((output as any).cameraY).toBe(
				(branch.origin.y + output.model.tipY(branch, now)) / 2
			)
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
		now = 1
		output.allNotesOff()
		now = 1.2
		output.noteOn(64, 80)
		now = 2.2
		output.allNotesOff()
		return {
			output,
			render(time: number) {
				now = time
				;(output as any).draw(now)
				return colors.slice(0, 2)
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
		expect(fading[0][2]).toBeLessThan(peak[0][2])
		expect(fading[0][2]).toBeGreaterThan(regular[0][2])
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
		expect(hard.render(3)[0][2]).toBeGreaterThan(soft.render(3)[0][2])
		hard.setTime(3.1)
		hard.output.noteOn(69, 20)
		expect(soft.render(3.5)).toEqual(regular)
		expect(hard.render(3.5)[0][2]).toBeGreaterThan(regular[0][2])
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
		now += 5
		let forks = 0,
			leaves = 0
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
					// Skip the ground and the bark: note colours never use those reds.
					if (
						Math.abs(data[i + 5] - 0.64) < 0.01 ||
						Math.abs(data[i + 5] - 0.18) < 0.01
					) {
						continue
					}
					leaves += data[i + 8]
					forks += 1 - data[i + 8]
					if (checkFit) {
						expect(data[i]).toBeGreaterThan(0)
						expect(data[i + 1]).toBeGreaterThan(0)
						expect(data[i + 2]).toBeLessThan(width)
						expect(data[i + 3]).toBeLessThan(height)
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
		// Each branch keeps at least its four-segment arc at any distance.
		expect(forks).toBeGreaterThanOrEqual(8500 * 4)
		expect(appends[0]).toBe(false)
		expect(appends.length).toBeGreaterThan(1)
		expect(appends.slice(1).every(Boolean)).toBe(true)
		const fitScale = (output as any).scale
		expect(fitScale).toBeLessThan(0.02)
		checkFit = false
		;(output as any).zoomBy(1.4)
		expect((output as any).scale).toBeCloseTo(fitScale * 1.4)
		expect((output as any).viewMode).toBe("manual")
		// Zoomed back in on the last note, its leaf is drawn again.
		leaves = 0
		;(output as any).focusBranch(8499)
		expect(leaves).toBeGreaterThan(0)
		output.destroy()
	})
	it("ends released notes with a leaf, sizes stems and leaves by velocity, and lets the trunk keep growing", () => {
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
		const scan = () => {
			const stems: number[][] = [],
				leaves: number[][] = []
			for (let i = 0; i < frame.length; i += 12) {
				const item = Array.from(frame.slice(i, i + 8))
				if (frame[i + 8]) {
					leaves.push(item)
				} else if (
					frame[i] === frame[i + 2] &&
					Math.abs(frame[i] - (240 - (output as any).cameraX)) > 0.01 &&
					frame[i + 1] !== frame[i + 3]
				) {
					stems.push(item)
				}
			}
			return { stems, leaves }
		}
		output.noteOn(60, 30)
		output.noteOn(67, 127)
		now = 1
		;(output as any).draw(now)
		expect(scan().leaves).toHaveLength(0)
		expect(scan().stems).toHaveLength(2)
		output.allNotesOff()
		now = 2
		;(output as any).draw(now)
		const { stems, leaves } = scan()
		expect(stems).toHaveLength(2)
		expect(leaves).toHaveLength(2)
		// The soft root comes first, then the hard fifth: the radius is at index 4.
		expect(stems[1][4]).toBeGreaterThan(stems[0][4])
		expect(leaves[1][4]).toBeGreaterThan(leaves[0][4])
		for (let leaf = 0; leaf < 2; leaf++) {
			// Each leaf sits on the tip of its stem, in the colour of its note.
			expect(leaves[leaf].slice(0, 2)).toEqual(stems[leaf].slice(2, 4))
			expect(leaves[leaf].slice(5)).toEqual(stems[leaf].slice(5))
		}
		const trunkEnd = frame[15],
			lengths = stems.map((stem) => stem[1] - stem[3])
		now = 3
		;(output as any).draw(now)
		expect(frame[15]).toBeLessThan(trunkEnd)
		expect(scan().stems.map((stem) => stem[1] - stem[3])).toEqual(lengths)
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