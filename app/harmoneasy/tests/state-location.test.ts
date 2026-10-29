// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest"
import State from "../source/libs/state"
import {
	addToHistory,
	createStateURL,
	getLocationSettings,
	getShareLink
} from "../source/libs/location"

beforeEach(() => {
	window.history.replaceState(null, "", "http://localhost:3000/harmoneasy/")
})

describe("bookmark state persistence", () => {
	it("keeps large workspaces out of server requests and restores their exact values", () => {
		const options = {
			io: "workspace:" + "abc+/=".repeat(20000),
			midiControls: JSON.stringify([{ target: "tempo", cc: 20 }]),
			tempo: 120,
			enabled: false,
			name: "123 piano 🎹",
			channels: [1, 2]
		}
		const url = createStateURL(options)
		expect(url.search).toBe("")
		expect(url.pathname).toBe("/harmoneasy/")
		window.history.replaceState(null, "", url)
		expect(getLocationSettings({ volume: 50 })).toEqual({ volume: 50, ...options })
		expect(getShareLink(options)).toBe(url.href)
	})

	it("migrates legacy query bookmarks and preserves connection fragments", () => {
		window.history.replaceState(
			null,
			"",
			"?tempo=123&enabled=false&io=workspace%3Aabc#sync-bundle=offer"
		)
		const state = new State(document.createElement("main"))
		state.addEventListener(() => {})
		state.loadFromLocation({ volume: 50 })
		state.updateLocation()
		expect(window.location.search).toBe("")
		expect(new URLSearchParams(window.location.hash.slice(1)).get("sync-bundle")).toBe("offer")
		expect(getLocationSettings({})).toEqual({
			tempo: 123,
			enabled: false,
			io: "workspace:abc",
			volume: 50
		})
		expect(state.asURI).toBe(window.location.href)
	})

	it("replaces saved values without nesting previous URLs and restores browser history", () => {
		const state = new State(document.createElement("main"))
		state.addEventListener(() => {})
		state.setDefaults({ tempo: 100, io: "workspace:initial" })
		state.updateLocation()
		state.set("tempo", 110)
		const previous = window.history.state
		const previousUrl = window.location.href
		for (let tempo = 111; tempo <= 150; tempo++) {
			state.set("tempo", tempo)
		}
		expect(window.location.search).toBe("")
		expect(getLocationSettings({})).toEqual({ tempo: 150, io: "workspace:initial" })
		window.history.replaceState(previous, "", previousUrl)
		window.dispatchEvent(new PopStateEvent("popstate", { state: previous }))
		expect(state.get("tempo")).toBe(110)
		expect(state.asURI).toBe(previousUrl)
		state.set("tempo", 115)
		expect(getLocationSettings({})).toEqual({ tempo: 115, io: "workspace:initial" })
	})

	it("merges updates through the legacy history helper", () => {
		addToHistory({ tempo: 120, io: "workspace:abc" })
		addToHistory({ tempo: 130 })
		expect(window.location.search).toBe("")
		expect(getLocationSettings({})).toEqual({ tempo: 130, io: "workspace:abc" })
	})

	it("ignores corrupt fragments and retains defaults and legacy values", () => {
		window.history.replaceState(null, "", "?tempo=120#harmoneasy-state=broken")
		expect(getLocationSettings({ volume: 50 })).toEqual({ volume: 50, tempo: 120 })
	})
})