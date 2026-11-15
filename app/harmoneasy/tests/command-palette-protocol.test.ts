// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { afterEach, expect, it } from "vitest"
import { CommandRegistry, EMPTY_SCHEMA } from "audiobus/io/protocol-registry"
import { createCommandPalette } from "../source/services/command-palette"
import { EVENT_CLICK, EVENT_INPUT, EVENT_SUBMIT } from "audiobus/events/event-constants"

let lifetime: AbortController
afterEach(() => {
	lifetime.abort()
	document.body.replaceChildren()
})

it("renders registered commands without DOM controls and applies schema-based arguments", async () => {
	const page = new DOMParser().parseFromString(readFileSync("index.html", "utf8"), "text/html")
	document.body.replaceChildren(page.querySelector("#command-palette")!.cloneNode(true))
	lifetime = new AbortController()
	const registry = new CommandRegistry()
	let bpm = 120,
		enabled = false
	registry.register({
		id: "transport.configure",
		title: "Configure remote transport",
		description: "Set tempo and enable playback",
		inputSchema: {
			type: "object",
			properties: {
				bpm: { type: "number", minimum: 10, maximum: 303 },
				enabled: { type: "boolean" }
			},
			required: ["bpm", "enabled"],
			additionalProperties: false
		},
		execute: (args) => {
			bpm = args.bpm as number
			enabled = args.enabled as boolean
			return null
		}
	})
	registry.register({
		id: "hidden",
		title: "Unavailable command",
		description: "",
		inputSchema: EMPTY_SCHEMA,
		available: () => false,
		execute: () => null
	})
	createCommandPalette(document, lifetime.signal, registry)()
	const search = document.querySelector<HTMLInputElement>("#command-search")!
	search.value = "Configure remote transport"
	search.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
	const row = document.querySelector<HTMLElement>('#command-results [role="option"]')!
	expect(row.textContent).toContain("Configure remote transport")
	row.dispatchEvent(new Event(EVENT_CLICK))
	const value = document.querySelector<HTMLInputElement>("#command-argument-bpm")!
	value.value = "128"
	const enabledControl = document.querySelector<HTMLSelectElement>("#command-argument-enabled")!
	enabledControl.value = "true"
	document
		.querySelector("#command-editor")!
		.dispatchEvent(new Event(EVENT_SUBMIT, { bubbles: true, cancelable: true }))
	await Promise.resolve()
	await Promise.resolve()
	expect(bpm).toBe(128)
	expect(enabled).toBe(true)
	search.value = "Unavailable command"
	search.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
	expect(document.querySelector("#command-results")!.textContent).not.toContain(
		"Unavailable command"
	)
})

it("edits writable application properties through the shared registry", async () => {
	const page = new DOMParser().parseFromString(readFileSync("index.html", "utf8"), "text/html")
	document.body.replaceChildren(page.querySelector("#command-palette")!.cloneNode(true))
	lifetime = new AbortController()
	const registry = new CommandRegistry()
	let bpm = 120
	registry.registerProperty({
		id: "transport.tempo",
		title: "Tempo property",
		description: "Tempo",
		unit: "BPM",
		schema: { type: "number", minimum: 10, maximum: 303 },
		get: () => bpm,
		set: (value) => {
			bpm = value as number
		}
	})
	createCommandPalette(document, lifetime.signal, registry)()
	const search = document.querySelector<HTMLInputElement>("#command-search")!
	search.value = "Tempo property"
	search.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
	const row = document.querySelector<HTMLElement>('#command-results [role="option"]')!
	expect(row.textContent).toContain("BPM")
	row.click()
	const value = document.querySelector<HTMLInputElement>("#command-argument-value")!
	value.value = "132"
	document
		.querySelector("#command-editor")!
		.dispatchEvent(new Event(EVENT_SUBMIT, { bubbles: true, cancelable: true }))
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
	expect(bpm).toBe(132)
	let label = "Named"
	registry.registerProperty({
		id: "device.label",
		title: "Device label",
		description: "",
		schema: { type: "string" },
		get: () => label,
		set: (value) => {
			label = value as string
		}
	})
	search.value = "Device label"
	search.dispatchEvent(new Event(EVENT_INPUT, { bubbles: true }))
	document.querySelector<HTMLElement>('#command-results [role="option"]')!.click()
	document.querySelector<HTMLInputElement>("#command-argument-value")!.value = ""
	document
		.querySelector("#command-editor")!
		.dispatchEvent(new Event(EVENT_SUBMIT, { bubbles: true, cancelable: true }))
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
	expect(label).toBe("")
})