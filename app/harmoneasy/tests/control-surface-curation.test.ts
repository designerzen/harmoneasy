// @vitest-environment happy-dom
import { expect, it, vi } from "vitest"
import {
	choiceIcon,
	controlIcon,
	controlImportance,
	featuredBindings,
	iconPath
} from "control-surface"
import { menuIcon } from "control-surface/dropdown"
import { validSurfaces } from "control-surface/model"
import type { ControlBinding, ControlDescriptor, SurfaceState } from "control-surface/types"
import {
	portableSurface,
	readSharedSurface,
	importSharedSurface,
	resolvePortableSurface,
	surfaceShareURL,
	takeSurfaceNotice
} from "../source/components/graph/control-surface-share"

const binding = (
	sourceId: string,
	d: Partial<ControlDescriptor> & { id: string }
): ControlBinding => ({
	key: JSON.stringify([sourceId, d.id]),
	sourceId,
	sourceLabel: sourceId,
	descriptor: { label: d.id, widget: "dial", ...d },
	read: () => 0,
	write: vi.fn()
})

it("ranks expressive controls above plumbing and honours author priority", () => {
	expect(controlImportance({ id: "cutoff", label: "Cutoff", widget: "dial" })).toBeGreaterThan(
		controlImportance({ id: "midiChannel", label: "MIDI Channel", widget: "radio" })
	)
	expect(controlImportance({ id: "x", label: "X", widget: "text", priority: 0.9 })).toBe(0.9)
	expect(
		controlImportance({ id: "volume", label: "Volume", widget: "dial", disabled: true })
	).toBe(0)
})

it("features a fair share from every component with one large performance gadget", () => {
	const synth = ["volume", "cutoff", "resonance", "attack", "release", "port", "name"].map((id) =>
		binding("synth", { id, widget: id === "name" ? "text" : "dial" })
	)
	const drums = ["groove", "density", "volume"].map((id) => binding("drums", { id }))
	const performance = ["relative-keys", "strum", "piano-roll"].map((widget) =>
		binding("synth", { id: widget, widget: widget as ControlDescriptor["widget"] })
	)
	const featured = featuredBindings([...synth, ...drums, ...performance], 8)
	const keys = featured.map((b) => b.descriptor.id)
	expect(featured).toHaveLength(8)
	expect(keys).toContain("relative-keys")
	expect(keys).not.toContain("strum")
	expect(keys).not.toContain("name")
	expect(featured.some((b) => b.sourceId === "drums")).toBe(true)
	// Author order is preserved so related controls stay together.
	expect(keys.indexOf("volume")).toBeLessThan(keys.indexOf("cutoff"))
})

it("pairs controls with meaningful icons in both GPU strokes and SVG", () => {
	expect(controlIcon({ id: "filterCutOff", label: "Cutoff", widget: "dial" })).toBe("filter")
	expect(controlIcon({ id: "masterVolume", label: "Volume", widget: "slider" })).toBe("volume")
	expect(controlIcon({ id: "go", label: "Go", widget: "button", icon: "play" })).toBe("play")
	expect(controlIcon({ id: "keys", label: "Keys", widget: "relative-keys" })).toBe("keys")
	expect(controlIcon({ id: "colour", label: "Colour", widget: "color" })).toBeUndefined()
	expect(choiceIcon({ label: "Stop", value: 0 })).toBe("stop")
	expect(choiceIcon({ label: "Lead", value: 1 })).toBeUndefined()
	expect(iconPath("stop")).toBe("M6 6L18 6L18 18L6 18L6 6")
	expect(menuIcon("share").innerHTML).toContain("M12 15V3")
	expect(menuIcon("tempo").innerHTML).toContain(iconPath("tempo"))
})

it("shares a surface by component role and rebinds it to the recipient's devices", () => {
	const state: SurfaceState = {
		id: "mine",
		name: "Live set",
		theme: "amber",
		background: { sourceId: "audio:synth-a", kind: "waveform" },
		connections: [
			{ componentId: "synth-a", controlIds: ["cutoff"] },
			{ componentId: "sampler-a", controlIds: ["volume"] }
		],
		widgets: [
			{ key: JSON.stringify(["synth-a", "cutoff"]), span: 2 },
			{ key: JSON.stringify(["sampler-a", "volume"]) }
		]
	}
	const sender = new Map([
		["synth-a", { kind: "instrument:synth", name: "Synth" }],
		["sampler-a", { kind: "instrument:sampler", name: "Sampler" }]
	])
	const portable = portableSurface(state, sender)
	expect(portable.surface).not.toContain("synth-a")
	expect(portable.surface).not.toContain("mine")

	const recipient = new Map([
		["drums-b", { kind: "instrument:drums", name: "Drums" }],
		["synth-b", { kind: "instrument:synth", name: "Bright Synth" }]
	])
	const resolved = resolvePortableSurface(portable, recipient, "theirs")!
	expect(resolved.missing).toEqual([{ kind: "instrument:sampler", name: "Sampler" }])
	expect(resolved.state.id).toBe("theirs")
	expect(resolved.state.background?.sourceId).toBe("audio:synth-b")
	expect(resolved.state.connections).toEqual([{ componentId: "synth-b", controlIds: ["cutoff"] }])
	expect(resolved.state.widgets).toEqual([
		{ key: JSON.stringify(["synth-b", "cutoff"]), span: 2 }
	])
	expect(validSurfaces([resolved.state])).toBe(true)

	const url = surfaceShareURL(state, sender, "https://example.test/app?x=1#io=1")
	expect(new URL(url).search).toBe("")
	expect(readSharedSurface(url)).toEqual(portable)
	expect(readSharedSurface("https://example.test/#surface=garbage")).toBeUndefined()
	expect(resolvePortableSurface({ ...portable, v: 2 as 1 }, recipient)).toBeUndefined()
})

it("imports a shared surface as the main surface and explains skipped controls once", () => {
	const state: SurfaceState = {
		id: "mine",
		name: "Shared",
		connections: [{ componentId: "sampler-a", controlIds: ["volume"] }],
		widgets: [{ key: JSON.stringify(["sampler-a", "volume"]) }]
	}
	const portable = portableSurface(
		state,
		new Map([["sampler-a", { kind: "instrument:sampler", name: "Sampler" }]])
	)
	const chain = {
		options: {
			controlSurfaces: [] as SurfaceState[],
			mainSurfaceId: undefined as string | undefined
		},
		setGraphOptions(options: object) {
			Object.assign(this.options, options)
		}
	}
	const imported = importSharedSurface(chain as never, portable, new Map())!
	expect(chain.options.controlSurfaces).toEqual([imported.state])
	expect(chain.options.mainSurfaceId).toBe(imported.state.id)
	expect(takeSurfaceNotice(imported.state.id)).toContain("no Sampler")
	expect(takeSurfaceNotice(imported.state.id)).toBeUndefined()
})
it("treats device modes as configuration and makes long choice lists one-click grids", async () => {
	const { choiceWidget } = await import("../../../packages/control-surface/src/choices")
	const operating = { id: "mode", label: "Operating mode", widget: "select" } as const
	expect(controlIcon(operating)).toBe("control")
	expect(controlIcon({ id: "mode", label: "Mode", widget: "select" })).toBe("scale")
	expect(controlImportance(operating)).toBeLessThan(
		controlImportance({ id: "mode", label: "Mode", widget: "select" })
	)
	const modes = Array.from({ length: 9 }, (_, i) => ({ label: `Mode ${i}`, value: `m${i}` }))
	expect(choiceWidget({ ...operating, choices: modes })).toBe("radio")
})