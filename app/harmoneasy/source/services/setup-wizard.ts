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
	wizardAIPrompt,
	wizardContexts,
	WIZARD_AI_SCHEMA,
	WIZARD_FEEDBACK,
	WIZARD_GOALS,
	WIZARD_INPUTS,
	WIZARD_INPUT_INSTRUCTIONS,
	WIZARD_CONNECTION_INPUTS,
	WIZARD_PACES,
	type WizardAnswers
} from "./setup-designer"
import { createPushToTalk } from "../libs/push-to-talk"
import {
	listSpeechRecognisers,
	type SpeechRecogniser,
	type SpeechRecogniserId
} from "../libs/speech-recognisers"
import {
	interpretationHints,
	interpretSetupDescription,
	withAISuggestion,
	type SetupInterpretation
} from "./setup-interpreter"

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
	let useAI = true
	let speech: ReturnType<typeof createPushToTalk> | undefined
	let speechOptions: Promise<SpeechRecogniser[]> | undefined
	let speechChoice: SpeechRecogniserId | undefined
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
		speech?.abort()
		request?.abort()
		request = undefined
		const build = dialog.querySelector<HTMLButtonElement>("[data-describe]")
		const stop = dialog.querySelector<HTMLButtonElement>("[data-ai-stop]")
		if (build) {
			build.disabled = false
		}
		if (stop) {
			stop.hidden = true
		}
	}
	const render = () => {
		const sequence = steps()
		const step = sequence[position]
		speech?.abort()
		speech = undefined
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
			help.textContent = browserAI()
				? "Describe what you want to play, make or practise, what you will play with and how you want to follow the notes. Local AI reads it on this device without an API key, and a phrase reader checks its answers. First use may download a large model. You will check the answers before creating anything."
				: "Describe what you want to play, make or practise, what you will play with and how you want to follow the notes. A phrase reader on this device fills in the questions for you to check. Local AI is not available in this browser; a browser with the built-in LanguageModel API understands descriptions better."
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
			const speak = document.createElement("button")
			speak.type = "button"
			speak.className = "secondary"
			speak.textContent = "Hold to speak"
			speak.hidden = true
			const speechLabel = document.createElement("label")
			speechLabel.textContent = "Speech recognition"
			speechLabel.hidden = true
			const speechSelect = document.createElement("select")
			speechSelect.addEventListener(EVENT_CHANGE, () => {
				speechChoice = speechSelect.value as SpeechRecogniserId
				recognisers.find((item) => item.id === speechChoice)?.prepare?.()
			})
			speechLabel.append(speechSelect)
			let recognisers: SpeechRecogniser[] = []
			let typed = ""
			speech = createPushToTalk(speak, {
				recogniser: () => recognisers.find((item) => item.id === speechChoice),
				onStart: () => {
					typed = input.value.trim()
				},
				onText: (text, final) => {
					input.value = typed ? `${typed} ${text}` : text
					description = input.value
					if (final) {
						status.textContent =
							"Speech added. Check the text, then choose Build from description."
					}
				},
				onStatus: (message) => {
					status.textContent = message
				}
			})
			speechOptions ??= listSpeechRecognisers()
			void speechOptions.then((list) => {
				if (!speak.isConnected || !list.length) {
					return
				}
				recognisers = list
				if (!list.some((item) => item.id === speechChoice)) {
					speechChoice = list[0].id
				}
				speechSelect.replaceChildren(
					...list.map((item) => {
						const option = document.createElement("option")
						option.value = item.id
						option.textContent = item.label
						option.selected = item.id === speechChoice
						return option
					})
				)
				recognisers.find((item) => item.id === speechChoice)?.prepare?.()
				speak.hidden = false
				speechLabel.hidden = false
				help.append(
					' Or hold the "Hold to speak" button while you talk. The on-device options keep your voice on this device after a one-time download.'
				)
			})
			const aiToggle = document.createElement("label")
			const aiCheckbox = document.createElement("input")
			aiCheckbox.type = "checkbox"
			aiCheckbox.checked = useAI
			aiCheckbox.addEventListener(EVENT_CHANGE, () => {
				useAI = aiCheckbox.checked
			})
			aiToggle.append(aiCheckbox, "Use local AI")
			aiToggle.hidden = !browserAI()
			const build = document.createElement("button")
			build.type = "button"
			build.className = "secondary"
			build.dataset.describe = ""
			build.textContent = "Build from description"
			const stop = document.createElement("button")
			stop.type = "button"
			stop.className = "tertiary"
			stop.dataset.aiStop = ""
			stop.textContent = "Skip AI"
			stop.hidden = true
			let fallback: SetupInterpretation | undefined
			const showInterpretation = (result: SetupInterpretation) => {
				answers = result.answers
				interpretation = result
				selectedGoal = true
				position = steps().length - 1
				render()
			}
			const unmatched =
				"That description did not match a setup. Try naming what you want to do, a style such as jazz, or what you will play with. You can also use the questions."
			stop.addEventListener(EVENT_CLICK, () => {
				const local = fallback
				cancelRequest()
				if (local?.matched) {
					showInterpretation(local)
				} else {
					status.textContent = "AI stopped. You can use the questions."
				}
			})
			build.addEventListener(EVENT_CLICK, async () => {
				if (!description.trim()) {
					status.textContent = "Please describe what you would like to make."
					input.focus()
					return
				}
				cancelRequest()
				const local = interpretSetupDescription(description)
				if (!browserAI() || !useAI) {
					if (local.matched) {
						showInterpretation(local)
					} else {
						status.textContent = unmatched
						input.focus()
					}
					return
				}
				const controller = new AbortController()
				request = controller
				fallback = local
				build.disabled = true
				stop.hidden = false
				try {
					const value = await promptBrowserAI(
						wizardAIPrompt(description, interpretationHints(local)),
						WIZARD_AI_SCHEMA,
						controller.signal,
						(message) => {
							if (!controller.signal.aborted) {
								status.textContent =
									message === "Generating music…"
										? "Reading your description…"
										: message
							}
						}
					)
					if (controller.signal.aborted || !dialog.open) {
						return
					}
					showInterpretation(withAISuggestion(local, value))
				} catch (error) {
					if (controller.signal.aborted || !dialog.open) {
						return
					}
					const reason =
						error instanceof Error ? error.message : "AI could not suggest a setup."
					if (local.matched) {
						showInterpretation({
							...local,
							notes: [
								{
									topic: "activity",
									text: `Local AI could not help (${reason}), so the phrase reader chose these answers.`
								},
								...local.notes
							]
						})
					} else {
						status.textContent = `${reason} ${unmatched}`
					}
				} finally {
					if (request === controller) {
						request = undefined
						fallback = undefined
						build.disabled = false
						stop.hidden = true
					}
				}
			})
			const actions = document.createElement("div")
			actions.className = "wizard-describe-actions"
			actions.append(speak, build, stop, aiToggle)
			details.append(summary, help, label, speechLabel, actions)
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
			`${result.source === "ai" ? "Local AI read your description" : "This setup was read from your description"} as ${CONFIDENCE_LABELS[result.confidence]}. Use Back to check or change any answer.`
		)
		if (result.summary) {
			paragraph(result.summary)
		}
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
			paragraph(note.text)
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
		// A browser speech pack may have finished installing since the wizard was last open.
		speechOptions = undefined
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