// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest"
import { createSetupWizard } from "../source/services/setup-wizard"
import {
	designSetup,
	validateWizardAnswers,
	WIZARD_GOALS,
	WIZARD_FEEDBACK,
	wizardContexts,
	type WizardAnswers
} from "../source/services/setup-designer"
import { parsePresetLibrary } from "../../../packages/audiobus/io/preset-library"
import { START_CONTEXTS, createContextSetup } from "../source/services/start-context-catalogue"

const defaults: WizardAnswers = {
	goal: "play",
	contextId: "first-notes",
	input: "screen",
	feedback: "sound",
	pace: "suggested"
}
let wizard: ReturnType<typeof createSetupWizard> | undefined
afterEach(() => {
	wizard?.destroy()
	document.body.replaceChildren()
	vi.unstubAllGlobals()
})

it("builds valid routing and controls for every offered activity and feedback choice", () => {
	for (const goal of WIZARD_GOALS) {
		for (const context of wizardContexts(goal.id)) {
			for (const feedback of WIZARD_FEEDBACK) {
				const { setup } = designSetup({
					...defaults,
					goal: goal.id,
					contextId: context.id,
					feedback: feedback.id,
					input: "gamepad"
				})
				expect(() =>
					parsePresetLibrary(
						JSON.stringify({
							format: "harmoneasy-preset-library",
							version: 1,
							presets: [],
							setups: [setup]
						})
					)
				).not.toThrow()
				for (const chain of setup.chains) {
					for (const surface of chain.options.controlSurfaces ?? []) {
						for (const connection of surface.connections) {
							expect(chain.outputs).toContain(connection.componentId)
						}
					}
				}
			}
		}
	}
})

it("changes instruments, patterns, drums and tempo with the selected activity", () => {
	const bass = designSetup({ ...defaults, goal: "write", contextId: "bass", pace: "slow" }).setup
	const techno = designSetup({ ...defaults, goal: "genre", contextId: "techno" }).setup
	expect(bass.chains[0].steps).not.toEqual(techno.chains[0].steps)
	expect(bass.clock?.bpm).toBe(75)
	expect(techno.clock?.bpm).toBe(134)
	expect(techno.devices.some((device) => device.definition.type === "drum-accompaniment")).toBe(
		true
	)
	expect(bass.devices).not.toEqual(techno.devices)
})

it("removes all musical sound for silent feedback and preserves accessibility activities", () => {
	const silent = designSetup({
		...defaults,
		goal: "genre",
		contextId: "techno",
		feedback: "text"
	}).setup
	expect(
		silent.devices
			.filter((device) => device.direction === "output")
			.map((device) => device.definition.type)
	).toEqual(["ui", "describe"])
	expect(silent.chains[0].options.controlSurfaces).toBeUndefined()
	const tactile = designSetup({ ...defaults, goal: "access", contextId: "notation-touch" })
	expect(tactile.setup.devices.some((device) => device.definition.type === "vibrator")).toBe(true)
	expect(tactile.instructions.join(" ")).toContain("Some devices cannot vibrate")
})

it("adds real gamepad routing, leaves MIDI connection explicit, and shows notation for score workflows", () => {
	const gamepad = designSetup({ ...defaults, input: "gamepad" }).setup
	expect(gamepad.chains[0].inputs).toContain("wizard-gamepad")
	expect(gamepad.devices.find((device) => device.id === "wizard-gamepad")?.definition.type).toBe(
		"gamepad-music"
	)
	expect(designSetup({ ...defaults, input: "midi" }).instructions[0]).toContain(
		"choose it in MIDI Devices"
	)
	const score = designSetup({
		...defaults,
		goal: "file",
		contextId: "midi-to-score",
		input: "gamepad"
	})
	expect(score.setup.devices.some((device) => device.definition.type === "notation")).toBe(true)
	expect(score.setup.devices.some((device) => device.id === "wizard-gamepad")).toBe(false)
})

it("rejects invented or mismatched AI answers without altering the factory setup", () => {
	const before = createContextSetup(START_CONTEXTS.find((context) => context.id === "techno")!)
	expect(() => validateWizardAnswers({ ...defaults, contextId: "techno" })).toThrow(
		"supported setup"
	)
	expect(() => validateWizardAnswers({ ...defaults, input: "invented-device" })).toThrow(
		"supported setup"
	)
	expect(() => validateWizardAnswers(null)).toThrow()
	designSetup({ ...defaults, goal: "genre", contextId: "techno", feedback: "text" })
	expect(createContextSetup(START_CONTEXTS.find((context) => context.id === "techno")!)).toEqual(
		before
	)
})

function mount() {
	const trigger = document.createElement("button")
	document.body.append(trigger)
	const start = vi.fn()
	wizard = createSetupWizard(trigger, start)
	const dialog = wizard.element
	dialog.showModal = vi.fn(() => {
		dialog.setAttribute("open", "")
	})
	dialog.close = vi.fn(() => {
		dialog.removeAttribute("open")
		dialog.dispatchEvent(new Event("close"))
	})
	trigger.click()
	const next = () => dialog.querySelector<HTMLButtonElement>("[data-next]")!.click()
	const back = () => dialog.querySelector<HTMLButtonElement>("[data-back]")!.click()
	const choose = (value: string) =>
		dialog.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.click()
	const title = () => dialog.querySelector("h3")!.textContent
	return { trigger, dialog, start, next, back, choose, title }
}

it("requires an answer, adds controller steps, and waits for explicit creation", () => {
	const ui = mount()
	expect(ui.dialog.querySelector<HTMLButtonElement>("[data-next]")!.disabled).toBe(true)
	ui.choose("play")
	ui.next()
	ui.choose("one-finger")
	ui.next()
	ui.choose("gamepad")
	ui.next()
	expect(ui.title()).toBe("Get your controller ready")
	ui.back()
	ui.choose("screen")
	ui.next()
	expect(ui.title()).toBe("How would you like to follow the notes?")
	ui.next()
	ui.next()
	expect(ui.title()).toBe("Your setup is ready to create")
	expect(ui.start).not.toHaveBeenCalled()
	expect(ui.dialog.textContent).toContain("replaces the workspace")
	ui.next()
	expect(ui.start).toHaveBeenCalledOnce()
	expect(ui.start.mock.calls[0][0].id).toBe("wizard:one-finger")
	expect(ui.dialog.open).toBe(false)
})

it("branches for files and accessibility without irrelevant controller or speed questions", () => {
	const ui = mount()
	ui.choose("file")
	ui.next()
	ui.next()
	expect(ui.title()).toBe("Your file comes next")
	ui.next()
	ui.next()
	expect(ui.title()).toBe("Your setup is ready to create")
	ui.dialog.querySelector<HTMLButtonElement>("header button")!.click()
	ui.trigger.click()
	ui.choose("access")
	ui.next()
	ui.choose("describe-silently")
	ui.next()
	ui.next()
	expect(ui.title()).toBe("Your setup is ready to create")
	expect(ui.start).not.toHaveBeenCalled()
})

it("keeps manual setup available when local AI is unsupported", () => {
	vi.stubGlobal("LanguageModel", undefined)
	const ui = mount()
	expect(ui.dialog.textContent).toContain("Local AI is not available")
	expect(
		[...ui.dialog.querySelectorAll("button")].find(
			(button) => button.textContent === "Suggest answers"
		)?.disabled
	).toBe(true)
	ui.choose("together")
	ui.next()
	ui.next()
	ui.next()
	expect(ui.title()).toBe("Help everyone play together")
})

it("reviews AI suggestions and destroys the local model session", async () => {
	const destroy = vi.fn()
	vi.stubGlobal("LanguageModel", {
		availability: vi.fn().mockResolvedValue("available"),
		create: vi.fn().mockResolvedValue({
			prompt: vi.fn().mockResolvedValue(
				JSON.stringify({
					...defaults,
					goal: "write",
					contextId: "bass",
					pace: "slow"
				})
			),
			destroy
		})
	})
	const ui = mount()
	const textarea = ui.dialog.querySelector("textarea")!
	textarea.value = "A slow bass line"
	textarea.dispatchEvent(new Event("input"))
	;[...ui.dialog.querySelectorAll("button")]
		.find((button) => button.textContent === "Suggest answers")!
		.click()
	await vi.waitFor(() => expect(ui.title()).toBe("Your setup is ready to create"))
	expect(ui.start).not.toHaveBeenCalled()
	expect(ui.dialog.textContent).toContain("75 beats per minute")
	expect(destroy).toHaveBeenCalledOnce()
	ui.back()
	expect(ui.title()).toBe("How fast should the music go?")
})

it("ignores AI results after closing and lets the questions recover from invalid results", async () => {
	let finish!: (value: string) => void
	const destroy = vi.fn()
	const prompt = vi.fn().mockImplementation(
		() =>
			new Promise<string>((resolve) => {
				finish = resolve
			})
	)
	vi.stubGlobal("LanguageModel", {
		availability: vi.fn().mockResolvedValue("available"),
		create: vi.fn().mockResolvedValue({ prompt, destroy })
	})
	const ui = mount()
	const textarea = ui.dialog.querySelector("textarea")!
	textarea.value = "Something musical"
	textarea.dispatchEvent(new Event("input"))
	const suggest = () =>
		[...ui.dialog.querySelectorAll("button")]
			.find((button) => button.textContent === "Suggest answers")!
			.click()
	suggest()
	await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
	ui.dialog.querySelector<HTMLButtonElement>("header button")!.click()
	finish(JSON.stringify(defaults))
	await vi.waitFor(() => expect(destroy).toHaveBeenCalled())
	ui.trigger.click()
	expect(ui.title()).toBe("What would you like to do?")
	prompt.mockResolvedValue(JSON.stringify({ ...defaults, contextId: "invented" }))
	suggest()
	await vi.waitFor(() =>
		expect(ui.dialog.querySelector(".wizard-status")!.textContent).toContain("supported setup")
	)
	ui.choose("play")
	ui.next()
	expect(ui.title()).toBe("What would you like to try?")
})