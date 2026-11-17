import type { PresetSetup } from "audiobus/io/preset-library"
import {
	EVENT_CANCEL,
	EVENT_CLICK,
	EVENT_CLOSE,
	EVENT_CHANGE,
	EVENT_INPUT
} from "audiobus/events/event-constants"
import { browserAI, promptBrowserAI } from "audiobus/io/browser-ai"
import {
	designSetup,
	validateWizardAnswers,
	wizardAIPrompt,
	wizardContexts,
	WIZARD_ANSWERS_SCHEMA,
	WIZARD_FEEDBACK,
	WIZARD_GOALS,
	WIZARD_INPUTS,
	WIZARD_INPUT_INSTRUCTIONS,
	WIZARD_CONNECTION_INPUTS,
	WIZARD_PACES,
	type WizardAnswers
} from "./setup-designer"
import { interpretSetupDescription, type SetupInterpretation } from "./setup-interpreter"

type Step =
	| "goal"
	| "recipe"
	| "input"
	| "connection"
	| "file"
	| "group"
	| "feedback"
	| "pace"
	| "review"

const GOAL_ICONS: Record<WizardAnswers["goal"], string> = {
	play: "piano",
	write: "notation",
	genre: "drums",
	file: "input",
	together: "midi",
	access: "hand"
}
const CHOICE_ICONS: Record<string, string> = {
	screen: "keyboard",
	midi: "midi",
	gamepad: "gamepad",
	pads: "drums",
	"music-mouse": "mouse",
	"microphone-pitch": "microphone",
	"microphone-trigger": "microphone",
	"camera-gestures": "hand",
	"step-sequencer": "clock",
	sound: "output",
	"sound-text": "describe",
	text: "describe",
	spoken: "speech",
	notation: "notation",
	suggested: "sparkles",
	slow: "clock",
	medium: "clock",
	fast: "clock",
	"describe-readout": "speech",
	"show-notation": "notation",
	"vibrate-notes": "vibration",
	"describe-silently": "describe",
	"notation-touch": "hand",
	bass: "synth",
	"remix-bass": "synth",
	"midi-to-score": "notation",
	convert: "input"
}
const CONFIDENCE_LABELS: Record<SetupInterpretation["confidence"], string> = {
	high: "a close match",
	medium: "a likely match",
	low: "a best guess"
}
const STEP_LABELS: Record<Step, string> = {
	goal: "Your goal",
	recipe: "Your music",
	input: "Your instruments",
	connection: "Connect",
	file: "Your file",
	group: "Play together",
	feedback: "Follow notes",
	pace: "Speed",
	review: "Review"
}

function wizardIcon(name: string) {
	const icon = document.createElement("span")
	icon.className = "wizard-icon"
	icon.setAttribute("aria-hidden", "true")
	icon.style.setProperty(
		"--wizard-icon",
		`url("${import.meta.env.BASE_URL}icons/device-${name}.svg")`
	)
	return icon
}

export function createSetupWizard(
	trigger: HTMLButtonElement,
	onStart: (setup: PresetSetup) => void
) {
	const dialog = document.createElement("dialog")
	dialog.id = "setup-wizard"
	dialog.setAttribute("aria-labelledby", "setup-wizard-title")
	dialog.innerHTML = `<header><h2 id="setup-wizard-title">Guided setup</h2><button type="button" class="tertiary close-icon" aria-label="Close setup wizard"></button></header>
		<div class="wizard-body"><p class="wizard-progress sr-only" role="status"></p><ol class="wizard-stepper" aria-label="Setup steps"></ol><section class="wizard-question" aria-labelledby="wizard-question-title"></section><p class="wizard-status" role="status" aria-live="polite"></p></div>
		<footer><button type="button" class="secondary" data-back>Back</button><button type="button" class="primary" data-next>Next</button></footer>`
	document.body.append(dialog)
	const question = dialog.querySelector<HTMLElement>(".wizard-question")!
	const progress = dialog.querySelector<HTMLElement>(".wizard-progress")!
	const status = dialog.querySelector<HTMLElement>(".wizard-status")!
	const back = dialog.querySelector<HTMLButtonElement>("[data-back]")!
	const next = dialog.querySelector<HTMLButtonElement>("[data-next]")!
	let answers: WizardAnswers = {
		goal: "play",
		contextId: "first-notes",
		inputs: ["screen"],
		feedback: "sound",
		pace: "suggested"
	}
	let selectedGoal = false
	let position = 0
	let request: AbortController | undefined
	let description = ""
	let aiNotice = ""
	let interpretation: SetupInterpretation | undefined
	const steps = (): Step[] => [
		"goal",
		"recipe",
		...(answers.goal === "file"
			? ["file" as const]
			: [
					"input" as const,
					...(answers.inputs.some((id) => WIZARD_CONNECTION_INPUTS.includes(id))
						? ["connection" as const]
						: [])
				]),
		...(answers.goal === "together" ? ["group" as const] : []),
		...(answers.goal === "access" ? [] : ["feedback" as const]),
		...(["access", "file"].includes(answers.goal) ? [] : ["pace" as const]),
		"review"
	]
	const paragraph = (text: string) => {
		const p = document.createElement("p")
		p.textContent = text
		question.append(p)
	}
	const updateProgress = () => {
		const sequence = steps()
		progress.textContent = `Step ${position + 1} of ${sequence.length} · ${STEP_LABELS[sequence[position]]}`
		const tracker = dialog.querySelector<HTMLOListElement>(".wizard-stepper")!
		tracker.replaceChildren(
			...sequence.map((step, index) => {
				const item = document.createElement("li")
				item.textContent = STEP_LABELS[step]
				item.dataset.state =
					index < position ? "complete" : index === position ? "current" : "upcoming"
				if (index === position) {
					item.setAttribute("aria-current", "step")
				}
				return item
			})
		)
	}
	const choices = (
		name: string,
		items: readonly { id: string; label: string; description?: string }[],
		value: string | readonly string[],
		change: (value: string) => void,
		multiple = false
	) => {
		const fieldset = document.createElement("fieldset")
		const legend = document.createElement("legend")
		legend.textContent = STEP_LABELS[steps()[position]]
		legend.className = "sr-only"
		fieldset.append(legend)
		items.forEach((item) => {
			const label = document.createElement("label")
			const radio = document.createElement("input")
			radio.type = multiple ? "checkbox" : "radio"
			radio.name = name
			radio.value = item.id
			radio.checked = typeof value === "string" ? value === item.id : value.includes(item.id)
			radio.addEventListener(EVENT_CHANGE, () => {
				cancelRequest()
				interpretation = undefined
				change(item.id)
				updateProgress()
				next.disabled = name === "wizard-input" && answers.inputs.length === 0
			})
			const text = document.createElement("span")
			text.textContent = item.label
			if (item.description) {
				const detail = document.createElement("small")
				detail.textContent = item.description
				text.append(detail)
			}
			const icon =
				name === "wizard-goal"
					? GOAL_ICONS[item.id as WizardAnswers["goal"]]
					: (CHOICE_ICONS[item.id] ?? GOAL_ICONS[answers.goal])
			label.append(radio, wizardIcon(icon), text)
			fieldset.append(label)
		})
		question.append(fieldset)
	}
	const cancelRequest = () => {
		request?.abort()
		request = undefined
		const suggest = dialog.querySelector<HTMLButtonElement>("[data-ai-suggest]")
		const stop = dialog.querySelector<HTMLButtonElement>("[data-ai-stop]")
		if (suggest) {
			suggest.disabled = !browserAI()
		}
		if (stop) {
			stop.hidden = true
		}
	}
	const render = () => {
		const sequence = steps()
		const step = sequence[position]
		question.replaceChildren()
		status.textContent = ""
		updateProgress()
		back.hidden = position === 0
		next.disabled =
			(step === "goal" && !selectedGoal) || (step === "input" && answers.inputs.length === 0)
		next.textContent = step === "review" ? "Create my setup" : "Next"
		const scene =
			step === "file" || (answers.goal === "file" && step !== "goal")
				? "file"
				: step === "group" || (answers.goal === "together" && step !== "goal")
					? "together"
					: "play"
		const illustration = document.createElement("img")
		illustration.className = "wizard-illustration"
		illustration.src = `${import.meta.env.BASE_URL}images/setup-${scene}.svg`
		illustration.alt = ""
		illustration.width = 640
		illustration.height = 160
		question.append(illustration)
		const heading = document.createElement("h3")
		heading.id = "wizard-question-title"
		heading.tabIndex = -1
		question.append(heading)
		const titles: Record<Step, string> = {
			goal: "What would you like to do?",
			recipe: "What would you like to try?",
			input: "What will you play with?",
			connection: "Get your instruments ready",
			file: "Your file comes next",
			group: "Help everyone play together",
			feedback: "How would you like to follow the notes?",
			pace: "How fast should the music go?",
			review: "Your setup is ready to create"
		}
		heading.textContent = titles[step]
		if (step === "goal") {
			choices("wizard-goal", WIZARD_GOALS, selectedGoal ? answers.goal : "", (value) => {
				if (answers.goal !== value) {
					answers = {
						...answers,
						goal: value as WizardAnswers["goal"],
						contextId: wizardContexts(value as WizardAnswers["goal"])[0].id,
						inputs: value === "file" ? ["screen"] : answers.inputs,
						feedback: "sound",
						pace: "suggested"
					}
				}
				selectedGoal = true
			})
			const details = document.createElement("details")
			const summary = document.createElement("summary")
			summary.textContent = "Or describe your idea in your own words (optional)"
			summary.prepend(wizardIcon("sparkles"))
			details.open = Boolean(description)
			const help = document.createElement("p")
			help.textContent =
				"Describe what you want to play, make or practise, what you will play with and how you want to follow the notes. Your words are read on this device and fill in the questions; you will check them before creating anything."
			const aiHelp = document.createElement("p")
			aiHelp.textContent = browserAI()
				? "Local AI can also suggest answers. It runs on this device without an API key, but first use may download a large model."
				: "Local AI is not available in this browser, so AI suggestions are off. A browser with the built-in LanguageModel API is needed for them."
			const label = document.createElement("label")
			label.textContent = "What would you like to make?"
			const input = document.createElement("textarea")
			input.rows = 3
			input.maxLength = 2000
			input.placeholder = "For example: slow one-finger chords with note names on screen"
			input.value = description
			input.addEventListener(EVENT_INPUT, () => {
				description = input.value
			})
			label.append(input)
			const build = document.createElement("button")
			build.type = "button"
			build.className = "secondary"
			build.textContent = "Build from description"
			build.addEventListener(EVENT_CLICK, () => {
				if (!description.trim()) {
					status.textContent = "Please describe what you would like to make."
					input.focus()
					return
				}
				cancelRequest()
				const result = interpretSetupDescription(description)
				if (!result.matched) {
					status.textContent =
						"That description did not match a setup. Try naming what you want to do, a style such as jazz, or what you will play with. You can also use the questions."
					input.focus()
					return
				}
				answers = result.answers
				interpretation = result
				aiNotice = ""
				selectedGoal = true
				position = steps().length - 1
				render()
			})
			const suggest = document.createElement("button")
			suggest.type = "button"
			suggest.className = "secondary"
			suggest.dataset.aiSuggest = ""
			suggest.textContent = "Suggest answers"
			suggest.disabled = !browserAI()
			const stop = document.createElement("button")
			stop.type = "button"
			stop.className = "tertiary"
			stop.dataset.aiStop = ""
			stop.textContent = "Stop AI"
			stop.hidden = true
			stop.addEventListener(EVENT_CLICK, () => {
				cancelRequest()
				suggest.disabled = false
				stop.hidden = true
				status.textContent = "AI stopped. You can use the questions."
			})
			suggest.addEventListener(EVENT_CLICK, async () => {
				if (!description.trim()) {
					status.textContent = "Please describe what you would like to make."
					input.focus()
					return
				}
				cancelRequest()
				const controller = new AbortController()
				request = controller
				suggest.disabled = true
				stop.hidden = false
				try {
					const result = await promptBrowserAI(
						wizardAIPrompt(description),
						WIZARD_ANSWERS_SCHEMA,
						controller.signal,
						(message) => {
							if (!controller.signal.aborted) {
								status.textContent =
									message === "Generating music…"
										? "Choosing answers for your setup…"
										: message
							}
						}
					)
					if (controller.signal.aborted || !dialog.open) {
						return
					}
					answers = validateWizardAnswers(result)
					selectedGoal = true
					interpretation = undefined
					aiNotice =
						"AI suggested these answers. Use Back to check or change them before creating your setup."
					position = steps().length - 1
					render()
				} catch (error) {
					if (!controller.signal.aborted) {
						status.textContent = `${error instanceof Error ? error.message : "AI could not suggest a setup."} You can continue with the questions.`
					}
				} finally {
					if (request === controller) {
						request = undefined
						suggest.disabled = false
						stop.hidden = true
					}
				}
			})
			const actions = document.createElement("div")
			actions.className = "wizard-describe-actions"
			actions.append(build, suggest, stop)
			details.append(summary, help, label, actions, aiHelp)
			question.append(details)
		} else if (step === "recipe") {
			choices(
				"wizard-recipe",
				wizardContexts(answers.goal).map((context) => ({
					id: context.id,
					label: context.name,
					description: context.description
				})),
				answers.contextId,
				(value) => {
					answers.contextId = value
				}
			)
		} else if (step === "input") {
			paragraph("Choose all that you want to use. You can play with more than one input.")
			choices(
				"wizard-input",
				WIZARD_INPUTS,
				answers.inputs,
				(value) => {
					const input = value as WizardAnswers["inputs"][number]
					answers.inputs = answers.inputs.includes(input)
						? answers.inputs.filter((id) => id !== input)
						: [...answers.inputs, input]
				},
				true
			)
		} else if (step === "feedback") {
			choices("wizard-feedback", WIZARD_FEEDBACK, answers.feedback, (value) => {
				answers.feedback = value as WizardAnswers["feedback"]
			})
		} else if (step === "pace") {
			choices("wizard-pace", WIZARD_PACES, answers.pace, (value) => {
				answers.pace = value as WizardAnswers["pace"]
			})
		} else if (step === "connection") {
			answers.inputs
				.filter((id) => WIZARD_CONNECTION_INPUTS.includes(id))
				.forEach((id) => paragraph(WIZARD_INPUT_INSTRUCTIONS[id]))
			paragraph(
				"If it does not connect, try the onscreen keys. You can finish the setup now and connect your controller later."
			)
		} else if (step === "file") {
			paragraph(
				"After creating your setup, use Upload to choose a MIDI, MusicXML, DawProject or tracker file. An ordinary audio recording such as an MP3 is not a note file."
			)
			paragraph(
				"Your file stays as it is. You can capture the result and use Export to save a new version."
			)
		} else if (step === "group") {
			paragraph(
				"Each person opens Harmoneasy on their own device. After starting, use Shared room and follow the pairing instructions to share timing."
			)
			paragraph(
				"Choose a classroom setup to keep notes in C major, or a jam setup for a different shared sound. You will still need to connect each player after starting."
			)
		} else {
			const { setup, instructions } = designSetup(answers)
			if (aiNotice) {
				paragraph(aiNotice)
			}
			if (interpretation) {
				describeInterpretation(interpretation)
			}
			const name = document.createElement("h4")
			name.textContent = setup.name
			question.append(name)
			paragraph(setup.description)
			const list = document.createElement("ul")
			list.className = "wizard-review"
			const feedback =
				answers.goal === "access"
					? "Feedback follows the activity you chose."
					: WIZARD_FEEDBACK.find((item) => item.id === answers.feedback)!.label +
						(answers.contextId === "midi-to-score" && answers.feedback !== "notation"
							? ", plus notes on a musical staff"
							: "")
			const summary = [
				WIZARD_GOALS.find((item) => item.id === answers.goal)!.label,
				answers.goal === "file"
					? "Import a music file after starting"
					: WIZARD_INPUTS.filter((item) => answers.inputs.includes(item.id))
							.map((item) => item.label)
							.join(", "),
				feedback,
				...(["file", "access"].includes(answers.goal)
					? []
					: [`Speed: ${setup.clock!.bpm} beats per minute`]),
				...instructions
			]
			for (const [index, text] of summary.entries()) {
				const li = document.createElement("li")
				const content = document.createElement("span")
				content.textContent = text
				const icon =
					index === 0
						? GOAL_ICONS[answers.goal]
						: index === 1
							? answers.goal === "file"
								? "input"
								: CHOICE_ICONS[answers.inputs[0]]
							: index === 2
								? answers.goal === "access"
									? "hand"
									: CHOICE_ICONS[answers.feedback]
								: "clock"
				li.append(wizardIcon(icon), content)
				list.append(li)
			}
			question.append(list)
			paragraph(
				"Creating this setup starts a fresh workspace and replaces the workspace from your previous session. You can change the sounds and patterns afterwards."
			)
		}
		heading.focus()
	}
	const describeInterpretation = (result: SetupInterpretation) => {
		paragraph(
			`This setup was read from your description as ${CONFIDENCE_LABELS[result.confidence]}. Use Back to check or change any answer.`
		)
		const context = wizardContexts(answers.goal).find((item) => item.id === answers.contextId)!
		const list = document.createElement("ul")
		list.className = "wizard-interpretation"
		const topics = {
			activity: "Activity",
			inputs: "Play with",
			feedback: "Follow notes",
			pace: "Speed"
		}
		for (const reason of result.reasons) {
			const li = document.createElement("li")
			const topic = document.createElement("strong")
			topic.textContent = `${topics[reason.topic]}: `
			// A chosen alternative replaces the activity the description pointed to.
			const text =
				reason.topic === "activity" && answers.contextId !== result.answers.contextId
					? `${context.name}, chosen instead`
					: reason.text
			li.append(topic, text)
			list.append(li)
		}
		question.append(list)
		result.notes.forEach((note) => {
			paragraph(note)
			question.lastElementChild!.className = "wizard-note"
		})
		const options = [
			{
				label: wizardContexts(result.answers.goal).find(
					(item) => item.id === result.answers.contextId
				)!.name,
				answers: result.answers
			},
			...result.alternatives
		].filter((option) => option.answers.contextId !== answers.contextId)
		if (options.length) {
			const group = document.createElement("div")
			group.className = "wizard-alternatives"
			group.setAttribute("role", "group")
			group.setAttribute("aria-label", "Other ways to read your description")
			const title = document.createElement("p")
			title.textContent = "Your description could also mean:"
			group.append(title)
			for (const option of options) {
				const button = document.createElement("button")
				button.type = "button"
				button.className = "tertiary"
				button.textContent = option.label
				button.addEventListener(EVENT_CLICK, () => {
					answers = structuredClone(option.answers)
					render()
				})
				group.append(button)
			}
			question.append(group)
		}
	}
	const close = () => {
		cancelRequest()
		dialog.close()
	}
	dialog.querySelector("header button")!.addEventListener(EVENT_CLICK, close)
	dialog.addEventListener(EVENT_CANCEL, cancelRequest)
	dialog.addEventListener(EVENT_CLOSE, cancelRequest)
	back.addEventListener(EVENT_CLICK, () => {
		cancelRequest()
		position--
		render()
	})
	next.addEventListener(EVENT_CLICK, () => {
		cancelRequest()
		if (steps()[position] === "review") {
			const { setup } = designSetup(answers)
			close()
			onStart(setup)
		} else {
			position++
			render()
		}
	})
	const open = () => {
		position = 0
		dialog.showModal()
		render()
	}
	trigger.addEventListener(EVENT_CLICK, open)
	return {
		element: dialog,
		destroy: () => {
			cancelRequest()
			trigger.removeEventListener(EVENT_CLICK, open)
			dialog.remove()
		}
	}
}