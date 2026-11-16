// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import { chooseChainsForMidiDevice } from "../source/services/midi-device-connected-dialog"

vi.mock("../source/components/graph/element-icons", () => ({
	deviceIcon: () => "/icons/device-synth.svg",
	elementIcon: () => "/icons/device-midi.svg"
}))

const device = { id: "keys", name: "Keys <b>", transport: "webmidi" as const }
const chain = (name: string) => ({
	options: { name },
	isDestroyed: false,
	inputs: [{ name: "Keyboard" }],
	transformers: [{ name: "Quantise" }],
	outputs: [{ name: "Synth" }]
})
const manager = (chains: ReturnType<typeof chain>[]) => ({ chains }) as unknown as IOChainManager
const dialog = () => document.querySelector<HTMLDialogElement>("dialog")!
const add = () => document.querySelector<HTMLButtonElement>("#midi-device-add")!
const choices = () => [...document.querySelectorAll<HTMLInputElement>(".midi-chain-option input")]
const all = () => document.querySelector<HTMLInputElement>(".midi-chain-all input")!

beforeEach(() => {
	const page = new DOMParser().parseFromString(readFileSync("index.html", "utf8"), "text/html")
	document.body.append(page.querySelector("#midi-device-connected-template")!.cloneNode(true))
})
afterEach(() => document.body.replaceChildren())

it("selects an arbitrary subset without closing and only adds on confirmation", async () => {
	const chains = [chain("Lead"), chain("Bass"), chain("Pads")]
	const result = chooseChainsForMidiDevice(manager(chains), device)
	expect(add().disabled).toBe(true)
	expect(document.querySelector(".midi-connected-name")!.textContent).toBe(device.name)
	expect(document.querySelector(".midi-chain-option")!.textContent).toContain(
		"Keyboard → Quantise → Synth"
	)
	expect(document.querySelectorAll(".midi-chain-option img")).toHaveLength(3)
	choices()[0].click()
	choices()[2].click()
	expect(dialog().open).toBe(true)
	expect(all().indeterminate).toBe(true)
	expect(add().textContent).toBe("Add to 2 chains")
	add().click()
	expect(await result).toEqual([chains[0], chains[2]])
	expect(document.querySelector("dialog")).toBeNull()
})

it("toggles all and clears selection, disabling confirmation", async () => {
	const result = chooseChainsForMidiDevice(manager([chain("Lead"), chain("Bass")]), device)
	all().click()
	expect(choices().every((input) => input.checked)).toBe(true)
	expect(all().indeterminate).toBe(false)
	all().click()
	expect(choices().some((input) => input.checked)).toBe(false)
	expect(add().disabled).toBe(true)
	dialog().close()
	expect(await result).toEqual([])
})

it("ignores pending selections and preselects a sole chain", async () => {
	const result = chooseChainsForMidiDevice(manager([chain("Lead")]), device)
	expect(choices()[0].checked).toBe(true)
	expect(document.querySelector<HTMLElement>(".midi-chain-all")!.hidden).toBe(true)
	document.querySelector<HTMLButtonElement>("#midi-device-ignore")!.click()
	expect(await result).toEqual([])
})

it("excludes chains destroyed while the dialog is open", async () => {
	const chains = [chain("Lead"), chain("Bass")]
	const result = chooseChainsForMidiDevice(manager(chains), device)
	all().click()
	chains[1].isDestroyed = true
	add().click()
	expect(await result).toEqual([chains[0]])
})

it("does not open a dialog when there are no live chains", async () => {
	expect(await chooseChainsForMidiDevice(manager([]), device)).toEqual([])
	expect(document.querySelector("dialog")).toBeNull()
})