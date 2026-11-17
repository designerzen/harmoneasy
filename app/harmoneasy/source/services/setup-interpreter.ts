import { createContextSetup } from "./start-context-catalogue"
import {
	validateWizardAnswers,
	wizardContexts,
	WIZARD_FEEDBACK,
	WIZARD_GOALS,
	WIZARD_INPUTS,
	type WizardAnswers,
	type WizardInput
} from "./setup-designer"

/**
 * Reads a plain-English description of a setup on this device, without a model download.
 * A description can talk about who the player is ("I'm blind", "my class"), what they want
 * to do, what they own, how they want to follow the notes and how fast the music should be,
 * so every phrase is scored against each of those topics separately. Negated phrases count
 * against a choice, longer phrases win over the words inside them, and ambiguous words add a
 * note so the player can check the result before creating anything.
 */

type Goal = WizardAnswers["goal"]
type Pace = Exclude<WizardAnswers["pace"], "suggested">
type FeedbackCue = "names" | "spoken" | "notation" | "silent" | "sound"
type Topic = "activity" | "inputs" | "feedback" | "pace"

interface Rule {
	pattern: RegExp
	contexts?: Record<string, number>
	goals?: Partial<Record<Goal, number>>
	inputs?: WizardInput[]
	feedback?: FeedbackCue
	pace?: Pace
	/** Shown whenever the phrase is used, to explain how an ambiguous word was read. */
	note?: string
	/** Hides every shorter phrase inside this one, not just phrases about the same topic. */
	consume?: boolean
}

interface Match {
	rule: Rule
	start: number
	end: number
	text: string
	negated: boolean
}

export interface SetupInterpretation {
	/** False when nothing in the description matched a supported choice. */
	matched: boolean
	/** "ai" when local AI chose the answers and the phrase rules only checked them. */
	source: "rules" | "ai"
	/** The AI's own short account of its answers. */
	summary?: string
	answers: WizardAnswers
	confidence: "high" | "medium" | "low"
	reasons: { topic: Topic; text: string }[]
	notes: { topic: Topic; text: string }[]
	alternatives: { label: string; answers: WizardAnswers }[]
}

const MAX_DESCRIPTION = 2000
const NEGATION_WINDOW = 4
const PACE_BPM: Record<Pace, number> = { slow: 75, medium: 110, fast: 150 }
const NEGATIONS = new Set([
	"no",
	"not",
	"without",
	"dont",
	"doesnt",
	"didnt",
	"never",
	"cant",
	"cannot",
	"wont",
	"isnt",
	"arent",
	"avoid",
	"except",
	"instead",
	"rather",
	"hate",
	"dislike",
	"nothing",
	"none",
	"neither",
	"nor"
])
/** Words that start a new idea, so a negation before them does not reach past them. */
const SCOPE_BREAKS = new Set(["so", "then", "just", "only", "use", "using", "please"])
const CLAUSE_BREAK = /[,.!?;:\n]|\b(?:but|however|although|though|so|then|because|whereas)\b/

const rule = (phrases: string[], effect: Omit<Rule, "pattern">): Rule => ({
	pattern: new RegExp(
		`\\b(?:${phrases.map((p) => p.replace(/ \?/g, "\\s*").replace(/ /g, "\\s+")).join("|")})\\b`,
		"g"
	),
	...effect
})

const KEYBOARD_NOTE =
	'"Keyboard" was read as a music keyboard. Choose "My screen or computer keyboard" if you meant your computer.'

const RULES: Rule[] = [
	// Who the player is and what they want to do overall.
	rule(
		[
			"learn\\w*",
			"beginners?",
			"new to (?:music|playing|this)",
			"first time",
			"just starting",
			"starting out",
			"teach me",
			"kids?",
			"child\\w*",
			"toddlers?",
			"have fun",
			"mess(?:ing)? around",
			"noodl\\w*",
			"explor\\w*"
		],
		{ goals: { play: 1.5 } }
	),
	rule(["lessons?"], { goals: { play: 1 }, contexts: { classroom: 1 } }),
	rule(
		[
			"writ(?:e|ing)",
			"compos\\w*",
			"songs?",
			"tracks?",
			"produc\\w*",
			"sketch\\w*",
			"ideas?",
			"record\\w*"
		],
		{ goals: { write: 1.5 } }
	),
	rule(["genres?", "styles?", "beats"], { goals: { genre: 1.5 } }),
	rule(["electronic", "dance music", "club\\w*", "edm"], {
		goals: { genre: 1.5 },
		contexts: { techno: 1, "acid-house": 1, electro: 1, "uk-garage": 0.5 }
	}),
	rule(
		[
			"files?",
			"upload\\w*",
			"import\\w*",
			"export\\w*",
			"musicxml",
			"music xml",
			"dawproject",
			"trackers?",
			"mod files?",
			"existing (?:piece|song|track|tune)s?",
			"midi files?",
			"mid files?"
		],
		{ goals: { file: 2 }, consume: true }
	),
	rule(["mp3s?", "wavs?", "audio files?", "audio recordings?", "recordings? of"], {
		goals: { file: 1 },
		note: "Audio recordings such as MP3 or WAV cannot be imported. File setups need MIDI, MusicXML, DawProject or a tracker file."
	}),
	rule(
		[
			"together",
			"other people",
			"others",
			"everyone",
			"group",
			"ensemble",
			"multiplayer",
			"remote\\w*",
			"online with"
		],
		{ goals: { together: 2 } }
	),
	rule(["accessib\\w*", "disab\\w*"], { goals: { access: 1.5 } }),

	// Learning activities.
	rule(
		[
			"(?:dont|do not) know (?:any )?(?:music |music theory|theory|scales|notes|keys)",
			"without knowing",
			"no experience",
			"never played",
			"complete beginner",
			"total beginner",
			"cant play",
			"wrong notes?"
		],
		{ contexts: { "first-notes": 3 } }
	),
	rule(["scales?"], { contexts: { "first-notes": 1.5 } }),
	rule(
		[
			"one finger",
			"single finger",
			"one hand\\w*",
			"easy chords?",
			"simple chords?",
			"big chords?",
			"full chords?",
			"small keyboard",
			"limited mobility",
			"mobility"
		],
		{ contexts: { "one-finger": 3 } }
	),
	rule(["chords?"], { contexts: { "one-finger": 0.5, songwriting: 0.5, "group-chords": 0.5 } }),
	rule(["practi[cs]\\w*", "exercis\\w*", "rehears\\w*", "drills?", "improve", "get better"], {
		contexts: { practice: 3 }
	}),
	rule(["minor key", "a minor"], { contexts: { practice: 1.5, "minor-song": 1 } }),
	rule(["arpeggi\\w*", "arps?", "broken chords?", "harp\\w*", "rolling"], {
		contexts: { arpeggios: 3 }
	}),

	// Writing activities.
	rule(
		[
			"chord progressions?",
			"progressions?",
			"songwrit\\w*",
			"four note chords?",
			"sevenths?",
			"seventh chords?"
		],
		{ contexts: { songwriting: 3 } }
	),
	rule(["accompan\\w*", "backing"], { contexts: { songwriting: 1, "group-chords": 1 } }),
	rule(
		[
			"sad",
			"moody",
			"mood\\w*",
			"dark",
			"melanchol\\w*",
			"emotional",
			"gloomy",
			"haunting",
			"brooding",
			"minor"
		],
		{ contexts: { "minor-song": 2.5, practice: 0.5 } }
	),
	rule(
		["melod\\w*", "hooks?", "riffs?", "catchy", "tunes?", "motifs?", "earworms?", "jingles?"],
		{
			contexts: { "melody-hook": 3 }
		}
	),
	rule(["bass ?lines?", "bass parts?", "bass"], { contexts: { bass: 3, "remix-bass": 1.5 } }),

	// Working with a file.
	rule(
		[
			"remix\\w*",
			"rework\\w*",
			"reharmoni[sz]\\w*",
			"mash ?ups?",
			"new version",
			"rearrang\\w*"
		],
		{
			contexts: { remix: 3, "remix-bass": 2 }
		}
	),
	rule(
		[
			"convert\\w*",
			"conversion",
			"transfer\\w*",
			"another (?:program|app|daw)",
			"between (?:programs|apps|daws)",
			"daws?",
			"ableton",
			"logic pro",
			"fl studio",
			"cubase",
			"reaper",
			"garageband",
			"bitwig",
			"musescore",
			"sibelius",
			"dorico"
		],
		{ contexts: { convert: 2.5 } }
	),
	rule(
		[
			"transcrib\\w*",
			"(?:into|to|as) (?:sheet music|notation|a score|score)",
			"sheet music from",
			"score from",
			"print\\w*"
		],
		{ contexts: { "midi-to-score": 3 } }
	),

	// Playing with other people.
	rule(["classrooms?", "class(?:es)?", "students?", "pupils?", "schools?", "teach\\w*"], {
		contexts: { classroom: 3 },
		goals: { together: 1 }
	}),
	rule(["jam\\w*", "improvi[sz]\\w*", "friends?", "bands?", "mates"], {
		contexts: { jam: 3 },
		goals: { together: 1 }
	}),
	rule(
		[
			"call and response",
			"take turns",
			"taking turns",
			"turn taking",
			"echo\\w*",
			"question and answer",
			"repeat after"
		],
		{ contexts: { "call-response": 3 }, goals: { together: 1 } }
	),
	rule(
		[
			"accompany (?:a|the) group",
			"support (?:a |the )?(?:group|choir|singers|band)",
			"sing ?alongs?",
			"choirs?",
			"campfire"
		],
		{ contexts: { "group-chords": 3 }, goals: { together: 1 } }
	),

	// Seeing, hearing or feeling the notes.
	rule(
		[
			"blind",
			"visually impaired",
			"vision impair\\w*",
			"low vision",
			"sight loss",
			"partially sighted",
			"screen ?readers?",
			"cant see"
		],
		{ contexts: { "describe-readout": 2.5 } }
	),
	rule(
		[
			"read (?:\\w+ ){0,2}(?:out|aloud)",
			"out loud",
			"aloud",
			"spoken",
			"speak(?!er)\\w*",
			"say (?:the )?(?:notes?|names?|chords?)",
			"announc\\w*",
			"voice ?over"
		],
		{ feedback: "spoken", contexts: { "describe-readout": 2 }, consume: true }
	),
	rule(["deaf\\w*", "hard of hearing", "hearing (?:impaired|loss)", "cant hear"], {
		contexts: {
			"vibrate-notes": 2,
			"notation-touch": 2,
			"show-notation": 1.5,
			"describe-silently": 1
		}
	}),
	rule(
		[
			"notation",
			"staff",
			"staves",
			"stave",
			"sheet music",
			"scores?",
			"treble clef",
			"read music"
		],
		{
			feedback: "notation",
			contexts: { "show-notation": 2, "notation-touch": 1.5, "midi-to-score": 1 }
		}
	),
	rule(
		[
			"vibrat\\w*",
			"haptic\\w*",
			"rumble",
			"tactile",
			"feel (?:the )?(?:notes?|music|beat|rhythm)",
			"touch"
		],
		{ contexts: { "vibrate-notes": 3, "notation-touch": 2 } }
	),
	rule(
		[
			"chord names?",
			"names? (?:of )?(?:the |each )?chords?",
			"(?:what|which) chords?",
			"identify (?:the )?chords?",
			"describ\\w*"
		],
		{ feedback: "names", contexts: { "describe-silently": 2 } }
	),
	rule(
		[
			"note names?",
			"names? of (?:the )?notes?",
			"(?:show|see|display) (?:the )?notes?",
			"letters",
			"labels?",
			"text"
		],
		{ feedback: "names" }
	),
	rule(
		[
			"(?:no|without) (?:any )?(?:music |instrument )?(?:sound|audio|noise)",
			"silen\\w*",
			"mute\\w*",
			"sound off"
		],
		{ feedback: "silent", contexts: { "describe-silently": 1, "show-notation": 0.5 } }
	),
	rule(
		[
			"hear (?:it|them|the music|the sound)",
			"want (?:any |the )?(?:sound|audio)",
			"with sound",
			"sound on"
		],
		{ feedback: "sound" }
	),

	// Styles of music. Contexts without a phrase here are matched by their name.
	rule(
		[
			"acid",
			"303",
			"tb 303",
			"acid house",
			"deep house",
			"house (?:music|tracks?|beats?|tunes?)"
		],
		{ contexts: { "acid-house": 3 } }
	),
	rule(["techno", "minimal", "raves?", "warehouse"], { contexts: { techno: 3 } }),
	rule(["dub", "reggae", "ska", "sound system"], { contexts: { dub: 3 } }),
	rule(["disco", "nu disco", "seventies", "70s"], { contexts: { disco: 3 } }),
	rule(["drum and bass", "drum n bass", "dnb", "d and b", "jungle", "liquid"], {
		contexts: { "drum-and-bass": 3 }
	}),
	rule(["funk\\w*"], { contexts: { funk: 3 } }),
	rule(["soul\\w*", "motown", "r and b", "rnb", "gospel"], { contexts: { soul: 3 } }),
	rule(["breakbeats?", "big beat", "breaks"], { contexts: { breakbeat: 3 } }),
	rule(["electro", "electro funk", "miami bass"], { contexts: { electro: 3 } }),
	rule(["uk garage", "garage", "2 step", "two step", "ukg", "speed garage"], {
		contexts: { "uk-garage": 3 }
	}),
	rule(["dubstep", "wobble", "brostep", "half time"], { contexts: { dubstep: 3 } }),
	rule(["trap", "hip hop", "hiphop", "rap\\w*", "808s?"], {
		contexts: { trap: 3, breakbeat: 1 }
	}),
	rule(["footwork", "juke"], { contexts: { footwork: 3 } }),
	rule(["samba", "carnival"], { contexts: { samba: 3 } }),
	rule(["brazil\\w*"], { contexts: { samba: 1.5, "bossa-nova": 1.5 } }),
	rule(["bossa\\w*", "bossa nova"], { contexts: { "bossa-nova": 3 } }),
	rule(["salsa", "mambo", "clave", "cuban"], { contexts: { salsa: 3 } }),
	rule(["cumbia", "colombian"], { contexts: { cumbia: 3 } }),
	rule(["latin\\w*"], {
		goals: { genre: 1 },
		contexts: { salsa: 1.5, samba: 1, "bossa-nova": 1, cumbia: 1 }
	}),
	rule(["jazz\\w*", "swing\\w*", "bebop", "lounge"], { contexts: { jazz: 3 } }),
	rule(["synth punk", "punk\\w*", "rock\\w*", "new wave"], { contexts: { "synth-punk": 3 } }),
	rule(["afro\\w*", "fela", "highlife"], { contexts: { afrobeat: 3 } }),
	rule(["percussion\\w*", "percussion ensemble", "drum circles?", "gamelan", "tuned drums"], {
		contexts: { "percussion-ensemble": 3 }
	}),
	rule(
		[
			"ambient",
			"atmospher\\w*",
			"drones?",
			"meditat\\w*",
			"soundscapes?",
			"ethereal",
			"dreamy",
			"spacey"
		],
		{ contexts: { ambient: 3 } }
	),
	rule(["chill\\w*", "relax\\w*"], { contexts: { ambient: 2 }, pace: "slow" }),

	// Speed.
	rule(
		[
			"slow\\w*",
			"gentle",
			"calm\\w*",
			"laid back",
			"easy going",
			"lazy",
			"ballads?",
			"downtempo",
			"mellow",
			"leisurely",
			"unhurried"
		],
		{ pace: "slow" }
	),
	rule(["medium", "moderate\\w*", "walking pace", "steady", "mid ?tempo", "normal speed"], {
		pace: "medium"
	}),
	rule(
		[
			"fast(?!\\s+(?:way|setup|start))",
			"quick(?!ly)(?!\\s+(?:way|setup|start|look|question|test))",
			"upbeat",
			"energetic",
			"lively",
			"high energy",
			"hype",
			"frantic",
			"rapid",
			"up ?tempo",
			"speedy",
			"intense"
		],
		{ pace: "fast" }
	),

	// What the player will use.
	rule(
		[
			"computer keyboard",
			"laptop keyboard",
			"typing keyboard",
			"qwerty",
			"laptop",
			"computer",
			"on ?screen",
			"touch ?screen",
			"tablet",
			"ipad",
			"phone",
			"mobile"
		],
		{ inputs: ["screen"], consume: true }
	),
	rule(
		[
			"midi\\w*",
			"midi keyboard",
			"midi controller",
			"keyboard controller",
			"controller keyboard",
			"music keyboard",
			"piano keyboard",
			"digital piano",
			"electric piano",
			"keytar",
			"synthesi[sz]ers?",
			"my synth",
			"launchkey",
			"akai",
			"novation",
			"arturia",
			"midi guitar"
		],
		{ inputs: ["midi"] }
	),
	rule(["keyboards?", "my piano"], { inputs: ["midi"], note: KEYBOARD_NOTE }),
	rule(
		[
			"game ?pads?",
			"game controllers?",
			"joy ?pads?",
			"joysticks?",
			"xbox",
			"playstation",
			"ps[345]",
			"switch pro",
			"dualsense"
		],
		{ inputs: ["gamepad"] }
	),
	rule(
		[
			"pads",
			"drum pads",
			"chord pads",
			"beat pads",
			"finger drum\\w*",
			"play (?:the )?drums",
			"drum along"
		],
		{ inputs: ["pads"] }
	),
	rule(["mouse", "trackpad", "touchpad"], { inputs: ["music-mouse"] }),
	rule(
		[
			"sing(?:s|ing|er|ers)?",
			"voice",
			"vocals?",
			"hum(?:s|ming)?",
			"whistl\\w*",
			"guitar\\w*",
			"violin\\w*",
			"cello\\w*",
			"flute\\w*",
			"sax\\w*",
			"trumpet\\w*",
			"ukulele\\w*",
			"acoustic\\w*",
			"real piano",
			"grand piano",
			"upright piano",
			"mic(?:rophone)?s?"
		],
		{ inputs: ["microphone-pitch"] }
	),
	rule(
		[
			"clap\\w*",
			"knock\\w*",
			"beatbox\\w*",
			"snap\\w* (?:my )?fingers",
			"tap (?:on )?(?:the )?table"
		],
		{
			inputs: ["microphone-trigger"]
		}
	),
	rule(
		[
			"cameras?",
			"webcams?",
			"hand gestures?",
			"gestures?",
			"wave my hands?",
			"theremin",
			"in the air",
			"air (?:piano|guitar|drums)"
		],
		{ inputs: ["camera-gestures"] }
	),
	rule(
		[
			"step sequencer",
			"sequencer",
			"pattern grid",
			"grid",
			"repeating pattern",
			"loop pattern",
			"drum machine"
		],
		{ inputs: ["step-sequencer"] }
	)
]

const CANDIDATES = WIZARD_GOALS.flatMap((goal) =>
	wizardContexts(goal.id).map((context) => ({ goal: goal.id as Goal, context }))
)

// Styles added to the catalogue later still match by their own name.
for (const { goal, context } of CANDIDATES) {
	const name = context.name
		.toLowerCase()
		.replace(/^write /, "")
		.replace(/-/g, " ")
	if (goal === "genre" && !RULES.some((item) => new RegExp(item.pattern.source).test(name))) {
		RULES.push(rule([name.replace(/[^a-z0-9 ]/g, "")], { contexts: { [context.id]: 3 } }))
	}
}

function normalise(text: string) {
	return text
		.slice(0, MAX_DESCRIPTION)
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/['’‘`]/g, "")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9,.!?;:\n]+/g, " ")
}

function isNegated(text: string, start: number) {
	const words = text.slice(0, start).split(CLAUSE_BREAK).pop()!.trim().split(/\s+/)
	for (const word of words.slice(-NEGATION_WINDOW).reverse()) {
		if (SCOPE_BREAKS.has(word)) {
			return false
		}
		if (NEGATIONS.has(word)) {
			return true
		}
	}
	return false
}

const topics = (item: Rule) =>
	[
		item.contexts || item.goals ? "activity" : "",
		item.inputs ? "inputs" : "",
		item.feedback ? "feedback" : "",
		item.pace ? "pace" : ""
	].filter(Boolean)

function findMatches(text: string): Match[] {
	const matches: Match[] = []
	for (const item of RULES) {
		for (const found of text.matchAll(item.pattern)) {
			matches.push({
				rule: item,
				start: found.index!,
				end: found.index! + found[0].length,
				text: found[0].replace(/\s+/g, " "),
				negated: isNegated(text, found.index!)
			})
		}
	}
	// "Drum and bass" is a style, not a request for drums and a bass line.
	return matches.filter(
		(match) =>
			!matches.some(
				(other) =>
					other !== match &&
					other.start <= match.start &&
					other.end >= match.end &&
					other.end - other.start > match.end - match.start &&
					(other.rule.consume ||
						topics(other.rule).some((topic) => topics(match.rule).includes(topic)))
			)
	)
}

const quote = (words: string[]) =>
	[...new Set(words)]
		.slice(0, 3)
		.map((word) => `"${word}"`)
		.join(", ")

export function interpretSetupDescription(description: string): SetupInterpretation {
	const text = normalise(description)
	const matches = findMatches(text)
	const positive = matches.filter((match) => !match.negated)
	const notes: SetupInterpretation["notes"] = []
	const note = (topic: Topic, text: string) => {
		if (!notes.some((item) => item.text === text)) {
			notes.push({ topic, text })
		}
	}
	for (const match of positive) {
		if (match.rule.note) {
			note(topics(match.rule)[0] as Topic, match.rule.note)
		}
	}

	// Activity: every phrase adds to the recipes it suggests and its goal adds to the whole group.
	const scores = new Map(CANDIDATES.map(({ context }) => [context.id, 0]))
	const evidence = new Map(CANDIDATES.map(({ context }) => [context.id, [] as string[]]))
	for (const match of matches) {
		const sign = match.negated ? -1 : 1
		const weights: [string, number][] = [
			...Object.entries(match.rule.contexts ?? {}),
			...Object.entries(match.rule.goals ?? {}).flatMap(([goal, weight]) =>
				wizardContexts(goal as Goal).map((context): [string, number] => [
					context.id,
					weight
				])
			)
		]
		for (const [id, weight] of weights) {
			if (scores.has(id)) {
				scores.set(id, scores.get(id)! + sign * weight)
				if (!match.negated) {
					evidence.get(id)!.push(match.text)
				}
			}
		}
	}
	const ranked = [...CANDIDATES].sort(
		(a, b) => scores.get(b.context.id)! - scores.get(a.context.id)!
	)
	const best = scores.get(ranked[0].context.id)!
	const top = best > 0 ? ranked[0] : CANDIDATES[0]

	// Inputs: the last mention of each wins, so "I can't play guitar but I sing" keeps the microphone.
	const mentioned = new Map<WizardInput, boolean>()
	for (const match of [...matches].sort((a, b) => a.start - b.start)) {
		match.rule.inputs?.forEach((id) => mentioned.set(id, !match.negated))
	}
	const inputs = WIZARD_INPUTS.map((item) => item.id).filter((id) => mentioned.get(id))
	const inputEvidence = positive.filter((match) =>
		match.rule.inputs?.some((id) => inputs.includes(id))
	)

	// Feedback: refusing sound asks for silence, and refusing silence asks for sound.
	const cues = new Set<FeedbackCue>()
	const feedbackEvidence: string[] = []
	for (const match of matches) {
		const cue = match.rule.feedback
		if (!cue) {
			continue
		}
		const resolved: FeedbackCue | undefined = !match.negated
			? cue
			: cue === "sound"
				? "silent"
				: cue === "silent"
					? "sound"
					: undefined
		if (resolved) {
			cues.add(resolved)
			feedbackEvidence.push(match.text)
		}
	}
	const silent = cues.has("silent") && !cues.has("sound")
	const feedback: WizardAnswers["feedback"] = cues.has("spoken")
		? "spoken"
		: cues.has("notation")
			? "notation"
			: cues.has("names")
				? silent
					? "text"
					: "sound-text"
				: silent
					? "text"
					: "sound"
	if (top.goal !== "access" && cues.has("sound") && ["spoken", "notation"].includes(feedback)) {
		note(
			"feedback",
			`"${WIZARD_FEEDBACK.find((item) => item.id === feedback)!.label}" replaces the instrument sound. Use Back to choose "Sound and written note names" if you want to hear the music.`
		)
	}

	// Speed: "not too fast" means a steady pace, and a tempo number picks the closest speed.
	const paceVotes: Pace[] = matches.flatMap((match) =>
		match.rule.pace ? [match.negated ? "medium" : match.rule.pace] : []
	)
	const paceEvidence = matches.filter((match) => match.rule.pace).map((match) => match.text)
	let pace: WizardAnswers["pace"] = "suggested"
	if (paceVotes.length) {
		const counts = paceVotes.map((vote) => paceVotes.filter((item) => item === vote).length)
		const most = Math.max(...counts)
		pace = paceVotes[counts.lastIndexOf(most)]
		if (new Set(paceVotes).size > 1) {
			note("pace", `The description mentions more than one speed, so "${pace}" was used.`)
		}
	}
	const tempo = /(\d{2,3})\s*(?:bpm|beats? (?:per|a) minute)/.exec(text)
	if (tempo) {
		const bpm = Number(tempo[1])
		const suggested = createContextSetup(top.context).clock?.bpm ?? PACE_BPM.medium
		paceEvidence.push(tempo[0])
		if (Math.abs(bpm - suggested) <= 12) {
			pace = "suggested"
		} else {
			pace = (Object.keys(PACE_BPM) as Pace[]).reduce((a, b) =>
				Math.abs(PACE_BPM[b] - bpm) < Math.abs(PACE_BPM[a] - bpm) ? b : a
			)
			note(
				"pace",
				`The closest available speed to ${bpm} BPM is ${PACE_BPM[pace]} BPM. You can set the exact tempo after starting.`
			)
		}
	}

	const finish = (goal: Goal, contextId: string): WizardAnswers =>
		validateWizardAnswers({
			goal,
			contextId,
			inputs: goal === "file" || !inputs.length ? ["screen"] : inputs,
			feedback: goal === "access" ? "sound" : feedback,
			pace: goal === "file" || goal === "access" ? "suggested" : pace
		})
	const answers = finish(top.goal, top.context.id)

	const reasons: SetupInterpretation["reasons"] = []
	const activityEvidence = evidence.get(top.context.id)!
	reasons.push({
		topic: "activity",
		text:
			best > 0
				? `${top.context.name}, from ${quote(activityEvidence)}`
				: `${top.context.name}, as a starting point`
	})
	if (best <= 0) {
		note(
			"activity",
			"The description did not mention an activity, so the wizard's first activity was used."
		)
	}
	if (top.goal === "file") {
		if (inputs.length) {
			note(
				"inputs",
				"File setups play your imported notes, so the instruments you mentioned are not added."
			)
		}
	} else if (inputs.length) {
		reasons.push({
			topic: "inputs",
			text: `${WIZARD_INPUTS.filter((item) => inputs.includes(item.id))
				.map((item) => item.label)
				.join(", ")}, from ${quote(inputEvidence.map((match) => match.text))}`
		})
	}
	if (top.goal !== "access" && feedbackEvidence.length) {
		reasons.push({
			topic: "feedback",
			text: `${WIZARD_FEEDBACK.find((item) => item.id === answers.feedback)!.label}, from ${quote(feedbackEvidence)}`
		})
	}
	if (paceEvidence.length) {
		if (answers.goal === "file" || answers.goal === "access") {
			note("pace", "Speed is not used for this kind of setup, so it was left as suggested.")
		} else {
			reasons.push({
				topic: "pace",
				text: `${pace === "suggested" ? "The activity's own speed" : `${pace[0].toUpperCase()}${pace.slice(1)} (${PACE_BPM[pace]} BPM)`}, from ${quote(paceEvidence)}`
			})
		}
	}

	const second = best > 0 ? scores.get(ranked[1].context.id)! : 0
	const confidence: SetupInterpretation["confidence"] =
		best >= 3 && best - second >= 1.5 ? "high" : best >= 1.5 ? "medium" : "low"
	const alternatives = ranked
		.slice(1)
		.filter(({ context }) => {
			const score = scores.get(context.id)!
			return best > 0 && score > 0 && score >= best / 2
		})
		.slice(0, 3)
		.map(({ goal, context }) => ({ label: context.name, answers: finish(goal, context.id) }))

	return {
		matched: matches.some((match) => !match.negated) || tempo !== null,
		source: "rules",
		answers,
		confidence,
		reasons,
		notes,
		alternatives
	}
}

const contextName = (answers: WizardAnswers) =>
	wizardContexts(answers.goal).find((context) => context.id === answers.contextId)!.name

/** A compact account of the phrase reading, given to local AI as a hint it may overrule. */
export function interpretationHints(result: SetupInterpretation) {
	if (!result.matched) {
		return "A keyword reader found no known phrases, so rely on the description alone."
	}
	return [
		"A keyword reader, which can miss context, suggested:",
		JSON.stringify(result.answers),
		...result.reasons.map((reason) => `${reason.topic}: ${reason.text}`),
		...(result.alternatives.length
			? [
					`Other possible contexts: ${result.alternatives.map((item) => item.answers.contextId).join(", ")}`
				]
			: []),
		...result.notes.map((item) => `Note: ${item.text}`)
	].join("\n")
}

/**
 * Prefers a valid AI answer, keeping the phrase evidence and notes for every topic both readings
 * agree on, and offering the phrase reading's activities as alternatives. Throws when the AI
 * answer is not a supported setup so the caller can fall back to the phrase reading.
 */
export function withAISuggestion(local: SetupInterpretation, value: unknown): SetupInterpretation {
	const answers = validateWizardAnswers(value)
	const explanation = (value as { explanation?: unknown }).explanation
	const agrees: Record<Topic, boolean> = {
		activity: local.matched && local.answers.contextId === answers.contextId,
		inputs: local.answers.inputs.join() === answers.inputs.join(),
		feedback: local.answers.feedback === answers.feedback,
		pace: local.answers.pace === answers.pace
	}
	const reasons = local.matched ? local.reasons.filter((reason) => agrees[reason.topic]) : []
	if (!agrees.activity) {
		reasons.unshift({ topic: "activity", text: `${contextName(answers)}, chosen by local AI` })
	}
	const alternatives: SetupInterpretation["alternatives"] = []
	for (const option of [
		...(local.matched ? [{ label: contextName(local.answers), answers: local.answers }] : []),
		...local.alternatives
	]) {
		if (
			option.answers.contextId !== answers.contextId &&
			!alternatives.some((item) => item.answers.contextId === option.answers.contextId)
		) {
			alternatives.push(option)
		}
	}
	return {
		matched: true,
		source: "ai",
		summary:
			typeof explanation === "string" && explanation.trim()
				? explanation.trim().slice(0, 300)
				: undefined,
		answers,
		confidence: agrees.activity ? "high" : "medium",
		reasons,
		notes: local.notes.filter((item) => agrees[item.topic]),
		alternatives: alternatives.slice(0, 3)
	}
}