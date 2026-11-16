// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest"
import { CommandRegistry } from "audiobus/io/protocol-registry"
import { registerInterfaceCommands } from "../source/services/interface-commands"
import { EVENT_CHANGE, EVENT_CLICK } from "audiobus/events/event-constants"

afterEach(() => document.body.replaceChildren())

function setup() {
	document.body.innerHTML = `
		<section data-midi-label="Transport">
			<button id="play" type="button">Play</button>
			<label><input id="metronome" type="checkbox"> Metronome</label>
			<label>Tempo <input id="tempo" type="range" min="10" max="303" value="120"></label>
			<label>Scale <select id="scale"><option value="major">Major</option><option value="minor">Minor</option><option value="locked" disabled>Locked</option></select></label>
			<button type="button" hidden>Hidden action</button>
		</section>
		<section data-midi-label="Mixer"><button type="button">Play</button></section>
		<dialog id="command-palette"><button type="button">Palette only</button></dialog>`
	const registry = new CommandRegistry()
	const remove = registerInterfaceCommands(document, registry)
	return { registry, remove }
}

it("lists the palette's visible controls with stable IDs, kinds, values and choices", async () => {
	const { registry } = setup()
	const controls = (await registry.call("ui.list")) as any[]
	expect(controls.map((control) => control.id)).toEqual([
		"transport/play",
		"transport/metronome",
		"transport/tempo",
		"transport/scale",
		"mixer/play"
	])
	expect(controls[2]).toMatchObject({ kind: "number", value: "120", min: 10, max: 303 })
	expect(controls[3]).toMatchObject({
		kind: "choice",
		value: "Major",
		options: ["Major", "Minor"]
	})
	expect(await registry.call("ui.list", { query: "mixer" })).toHaveLength(1)
})

it("presses buttons and toggles, and sets values with the original UI's events", async () => {
	const { registry } = setup()
	let played = 0
	document.getElementById("play")!.addEventListener(EVENT_CLICK, () => played++)
	await registry.call("ui.activate", { id: "transport/play" })
	expect(played).toBe(1)
	expect(await registry.call("ui.activate", { id: "transport/metronome" })).toMatchObject({
		value: "On"
	})
	const changes: string[] = []
	document
		.getElementById("scale")!
		.addEventListener(EVENT_CHANGE, (event) =>
			changes.push((event.target as HTMLSelectElement).value)
		)
	expect(
		await registry.call("ui.setValue", { id: "transport/scale", value: "Minor" })
	).toMatchObject({ value: "Minor" })
	expect(changes).toEqual(["minor"])
	await registry.call("ui.setValue", { id: "transport/tempo", value: "128" })
	expect((document.getElementById("tempo") as HTMLInputElement).value).toBe("128")
})

it("rejects unknown controls, wrong operations, disabled choices and out-of-range numbers", async () => {
	const { registry, remove } = setup()
	for (const [id, args] of [
		["ui.activate", { id: "transport/missing" }],
		["ui.activate", { id: "palette-only" }]
	] as const) {
		await expect(registry.call(id, args)).rejects.toMatchObject({ code: "unavailable" })
	}
	for (const [id, args] of [
		["ui.activate", { id: "transport/scale" }],
		["ui.setValue", { id: "transport/play", value: "x" }],
		["ui.setValue", { id: "transport/scale", value: "Locked" }],
		["ui.setValue", { id: "transport/tempo", value: "999" }],
		["ui.setValue", { id: "transport/tempo", value: "fast" }]
	] as const) {
		await expect(registry.call(id, args)).rejects.toMatchObject({ code: "invalid_params" })
	}
	remove()
	expect(registry.list()).toEqual([])
})
it("never moves an ID to another control, and lists fields with step any", async () => {
	document.body.innerHTML = `
		<section data-midi-label="Tracks">
			<button type="button" id="first">Delete</button>
			<button type="button" id="second">Delete</button>
			<label>Gain <input type="number" step="any" value="0.5"></label>
		</section>`
	const registry = new CommandRegistry()
	registerInterfaceCommands(document, registry)
	const controls = (await registry.call("ui.list")) as any[]
	expect(controls.map((control) => control.id)).toEqual([
		"tracks/delete",
		"tracks/delete~2",
		"tracks/gain"
	])
	expect(controls[2]).not.toHaveProperty("step")
	const clicked: string[] = []
	for (const id of ["first", "second"]) {
		document.getElementById(id)!.addEventListener(EVENT_CLICK, () => clicked.push(id))
	}
	;(document.getElementById("first") as HTMLButtonElement).disabled = true
	await expect(registry.call("ui.activate", { id: "tracks/delete" })).rejects.toMatchObject({
		code: "unavailable"
	})
	expect(clicked).toEqual([])
	await registry.call("ui.activate", { id: "tracks/delete~2" })
	expect(clicked).toEqual(["second"])
	// Once removed from the page, an ID may pass to a re-rendered control of the same name.
	document.getElementById("first")!.remove()
	const replacement = document.createElement("button")
	replacement.type = "button"
	replacement.textContent = "Delete"
	document.querySelector("section")!.prepend(replacement)
	expect(
		((await registry.call("ui.list", { query: "delete" })) as any[]).map((c) => c.id)
	).toEqual(["tracks/delete", "tracks/delete~2"])
})
it("rejects off-step and non-decimal numbers and finds controls by ID without rescanning", async () => {
	const { registry } = setup()
	const tempo = document.getElementById("tempo") as HTMLInputElement
	tempo.step = "0.5"
	await registry.call("ui.list")
	const set = (value: string) => registry.call("ui.setValue", { id: "transport/tempo", value })
	for (const value of ["0x10", "Infinity", "1e400", "120.25", "", " "]) {
		await expect(set(value)).rejects.toMatchObject({ code: "invalid_params" })
	}
	expect(await set(" 120.5 ")).toMatchObject({ value: "120.5" })
	tempo.step = "any"
	expect(await set("120.25")).toMatchObject({ value: "120.25" })
	// A control hidden since the last listing is unavailable until it is shown again.
	tempo.closest("label")!.hidden = true
	await expect(set("100")).rejects.toMatchObject({ code: "unavailable" })
	tempo.closest("label")!.hidden = false
	expect(await set("100")).toMatchObject({ id: "transport/tempo", value: "100" })
	await expect(registry.call("ui.activate", { id: "never/listed" })).rejects.toMatchObject({
		code: "unavailable"
	})
})