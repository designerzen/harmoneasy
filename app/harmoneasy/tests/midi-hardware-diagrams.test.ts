// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
	midiDeviceDirectory,
	midiDeviceFolders
} from "audiobus/hardware/midi-devices/device-files.js"

const devices = [
	"arcana-strum",
	"novation-circuit",
	"arturia-keystep",
	"arturia-microfreak",
	"arturia-drumbrute-impact",
	"akai-mpc-live",
	"cyclone-analogic-tt-303",
	"teenage-engineering-op-1",
	"roland-s-1",
	"roland-tb-3",
	...midiDeviceFolders()
		.map(({ id }) => id)
		.filter(
			(id) =>
				id.startsWith("korg-volca-") ||
				/^roland-(?:a-01|jp-08|ju-06|jx-03|vp-03|tb-03|tr-09|se-02|sh-01a|d-05|tr-08|ju-06a|tr-06|jd-08|jx-08|jupiter-08|n-vision)$/.test(
					id
				)
		)
]

describe.each(devices)("%s overhead diagrams", (id) => {
	const folder = midiDeviceDirectory(id)
	const profile = JSON.parse(readFileSync(path.join(folder, `${id}.json`), "utf8"))
	const diagram = (asset: string) =>
		new DOMParser().parseFromString(
			readFileSync(path.join(folder, `${asset}.svg`), "utf8"),
			"image/svg+xml"
		)

	// Icons are manufacturer logos copied by the midi-devices generator, not diagrams.
	it("icon is a titled manufacturer logo", () => {
		const document = diagram("icon")
		expect(document.querySelector("parsererror")).toBeNull()
		expect(document.documentElement.localName).toBe("svg")
		expect(document.querySelector("title")?.textContent?.trim()).toMatch(/logo$/i)
	})

	it("panel has addressable, labelled physical controls", () => {
		const asset = "panel"
		const document = diagram(asset)
		expect(document.querySelector("parsererror")).toBeNull()
		const ids = [...document.querySelectorAll("[id]")].map((node) => node.id)
		expect(new Set(ids).size).toBe(ids.length)
		expect(ids.every((value) => value.startsWith(`${id}-${asset}--`))).toBe(true)
		expect(document.documentElement.getAttribute("role")).toBe("group")
		for (const node of document.querySelectorAll("[aria-labelledby], [aria-describedby]")) {
			for (const attribute of ["aria-labelledby", "aria-describedby"]) {
				for (const reference of node.getAttribute(attribute)?.split(" ") ?? []) {
					expect(document.getElementById(reference)?.textContent?.trim()).toBeTruthy()
				}
			}
		}
		const parts = [...document.querySelectorAll("[data-part]")]
		expect(parts.length).toBeGreaterThan(profile.surface.elements.length / 2)
		for (const part of parts) {
			expect(part.id).toBe(`${id}-${asset}--${part.getAttribute("data-part")}`)
			expect(part.getAttribute("aria-label")?.trim()).toBeTruthy()
			expect(part.querySelector("title")?.textContent?.trim()).toBeTruthy()
			// Standalone artwork has no input handlers; the live surface supplies them.
			if (part.getAttribute("role") === "button") {
				expect(part.getAttribute("aria-disabled")).toBe("true")
				expect(part.getAttribute("tabindex")).toBe("-1")
			}
		}
	})

	it("keeps live MIDI hit areas aligned with the artwork", () => {
		const document = diagram("panel")
		const { width, height, elements } = profile.surface
		expect(document.documentElement.getAttribute("viewBox")).toBe(`0 0 ${width} ${height}`)
		const regions = [...document.querySelectorAll("[data-surface-control]")]
		expect(regions).toHaveLength(elements.length)
		for (const element of elements) {
			const region = document.getElementById(`${id}-panel--surface--${element.id}`)!
			expect(region?.getAttribute("data-surface-control")).toBe(element.id)
			expect(region.closest("[data-part], [data-region]")).not.toBeNull()
			const rect = region.querySelector("rect")!
			for (const [attribute, coordinate, scale] of [
				["x", "x", width],
				["y", "y", height],
				["width", "width", width],
				["height", "height", height]
			] as const) {
				expect(Number(rect.getAttribute(attribute))).toBeCloseTo(
					(element.position[coordinate] * scale) / 100,
					5
				)
			}
		}
	})

	it("panel uses outline wireframes without shaded parts", () => {
		const document = diagram("panel")
		for (const shape of document.querySelectorAll(
			"rect, circle, ellipse, path, line, polygon, polyline"
		)) {
			expect(shape.getAttribute("fill")).toBe("none")
			expect(shape.getAttribute("stroke")).toBe("currentColor")
		}
	})
})