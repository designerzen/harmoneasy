// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createMasterMute } from "../source/services/export-wiring"
import { parseInitialTempo, parseInitialVolumePercent } from "../source/services/transport-wiring"
import { installExportMenu } from "../source/services/export-menu"
import { renderVexFlowModal } from "../source/services/vexflow-modal"
import { readFileSync } from "node:fs"

afterEach(() => {
	document.body.replaceChildren()
	vi.restoreAllMocks()
})

describe("startup state parsing", () => {
	it("preserves explicit zero volume and falls back only for missing or invalid values", () => {
		expect(parseInitialVolumePercent(0)).toBe(0)
		expect(parseInitialVolumePercent("0")).toBe(0)
		expect(parseInitialVolumePercent(75)).toBe(75)
		expect(parseInitialVolumePercent("42.5")).toBe(42.5)
		expect(parseInitialVolumePercent(undefined)).toBe(50)
		expect(parseInitialVolumePercent("")).toBe(50)
		expect(parseInitialVolumePercent("not-a-number")).toBe(50)
	})

	it("guards persisted tempo against NaN or non-positive values", () => {
		expect(parseInitialTempo(128)).toBe(128)
		expect(parseInitialTempo("96.5")).toBe(96.5)
		expect(parseInitialTempo(0)).toBe(99)
		expect(parseInitialTempo(-10)).toBe(99)
		expect(parseInitialTempo("invalid")).toBe(99)
		expect(parseInitialTempo(undefined)).toBe(99)
	})
})

describe("master mute ramping", () => {
	it("ramps master gain down and back to the prior volume via AudioParam scheduling", () => {
		let currentTime = 1.25
		const cancelScheduledValues = vi.fn()
		const setTargetAtTime = vi.fn()
		const audioBus = {
			audioContext: {
				get currentTime() {
					return currentTime
				}
			} as unknown as AudioContext,
			output: {
				gain: {
					value: 0.7,
					cancelScheduledValues,
					setTargetAtTime
				}
			} as unknown as GainNode
		}

		const mute = createMasterMute(audioBus)
		const restore = mute()
		expect(cancelScheduledValues).toHaveBeenCalledWith(1.25)
		expect(setTargetAtTime).toHaveBeenCalledWith(0, 1.25, 0.005)

		currentTime = 2.5
		restore()
		expect(cancelScheduledValues).toHaveBeenLastCalledWith(2.5)
		expect(setTargetAtTime).toHaveBeenLastCalledWith(0.7, 2.5, 0.005)
	})
})

describe("extracted UI export helpers", () => {
	it("populates export sources and refreshes loaded songs when opening the export menu", async () => {
		document.body.innerHTML = `
			<button id="btn-export" type="button">Export</button>
			<menu id="export-options">
				<button id="btn-vexflow-export" type="button">Sheet music</button>
			</menu>
		`
		let songs = [{ id: "song-1", name: "Prelude", chain: "Chain 1" }]
		const onExport = vi.fn(async () => {})
		const exportButton = document.getElementById("btn-export")
		installExportMenu(
			document,
			exportButton,
			document.getElementById("btn-vexflow-export"),
			onExport,
			() => songs
		)

		const select = document.getElementById("export-source") as HTMLSelectElement
		expect([...select.options].map((option) => option.value)).toEqual(["recording", "song-1"])

		songs = [{ id: "song-2", name: "Etude", chain: "Chain 2" }]
		exportButton!.click()
		expect([...select.options].map((option) => option.value)).toEqual(["recording", "song-2"])

		select.value = "song-2"
		document.getElementById("btn-midi-export")!.click()
		expect(onExport).toHaveBeenCalledWith("midi", "song-2")

		const scores = document.querySelector('[data-export-kind="score"]')!
		expect(scores.querySelector("h3")?.textContent).toBe("Sheet music and tablature")
		expect(scores.querySelector("#btn-vexflow-export")).not.toBeNull()
		expect(document.getElementById("btn-midi-export")?.textContent).toContain(".mid")
	})

	it("renders VexFlow modal and triggers HTML download on button click", async () => {
		document.body.innerHTML = `
			<dialog id="info-dialog" hidden>
				<h5>Information</h5>
				<pre id="info-message"></pre>
			</dialog>
		`
		const dialog = document.getElementById("info-dialog") as HTMLDialogElement
		const showModal = vi.spyOn(dialog, "showModal").mockImplementation(() => {
			dialog.open = true
		})
		const saved: { blob: Blob; filename: string }[] = []
		await renderVexFlowModal(
			document,
			vi.fn(),
			(container) => {
				const svg = document.createElement("div")
				svg.textContent = "Score SVG"
				container.append(svg)
			},
			{ name: "Test Take" },
			{},
			async () => new Blob(["<html></html>"], { type: "text/html" }),
			(blob, filename) => saved.push({ blob, filename })
		)

		expect(showModal).toHaveBeenCalledOnce()
		expect(document.querySelector("#info-dialog h5")!.textContent).toBe("Musical Score")
		const download = document.querySelector<HTMLButtonElement>("#info-message button")!
		download.click()
		await vi.waitFor(() => expect(saved).toHaveLength(1))
		expect(saved[0].filename).toBe("Test Take")
	})
})

describe("package version consistency", () => {
	it("keeps app/harmoneasy/package.json version aligned with root package.json", () => {
		const rootPkg = JSON.parse(readFileSync("../../package.json", "utf8"))
		const appPkg = JSON.parse(readFileSync("package.json", "utf8"))
		expect(appPkg.version).toBe(rootPkg.version)
	})
})