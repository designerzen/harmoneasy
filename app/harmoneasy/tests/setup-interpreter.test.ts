import { expect, it } from "vitest"
import { interpretSetupDescription } from "../source/services/setup-interpreter"
import { designSetup, WIZARD_GOALS, wizardContexts } from "../source/services/setup-designer"

const read = (text: string) => interpretSetupDescription(text)

it("reads the activity, instruments, feedback and speed from one sentence", () => {
	const result = read("Slow one-finger chords with note names on screen")
	expect(result.matched).toBe(true)
	expect(result.answers).toEqual({
		goal: "play",
		contextId: "one-finger",
		inputs: ["screen"],
		feedback: "sound-text",
		pace: "slow"
	})
	expect(result.reasons.map((reason) => reason.topic)).toEqual([
		"activity",
		"inputs",
		"feedback",
		"pace"
	])
	expect(result.reasons[0].text).toContain('"one finger"')
})

it.each([
	["I've never played anything and don't know any scales", "play", "first-notes"],
	["I want to practise my scales in a minor key", "play", "practice"],
	["Let the arpeggios unfold from each note", "play", "arpeggios"],
	["Help me write a sad, moody song", "write", "minor-song"],
	["I need a catchy hook for my track", "write", "melody-hook"],
	["Write a bass line", "write", "bass"],
	["Some dnb please", "genre", "drum-and-bass"],
	["Bossa nova at a gentle pace", "genre", "bossa-nova"],
	["Something chill and atmospheric to relax to", "genre", "ambient"],
	["Hip hop beats with 808s", "genre", "trap"],
	["Upload a MIDI file and turn it into sheet music", "file", "midi-to-score"],
	["Remix an existing song into a bass part", "file", "remix-bass"],
	["Move my song from Ableton to MuseScore", "file", "convert"],
	["I teach a class of students who should play in time", "together", "classroom"],
	["Jam with my friends", "together", "jam"],
	["Kids take turns answering each other", "together", "call-response"],
	["I'm blind, please read the notes aloud", "access", "describe-readout"],
	["I'm deaf and want to feel the notes", "access", "vibrate-notes"],
	["Show the notes on a staff and let me feel them through vibration", "access", "notation-touch"]
])("understands %j", (text, goal, contextId) => {
	expect(read(text).answers).toMatchObject({ goal, contextId })
})

it("lets the more specific phrase win over the words inside it", () => {
	const result = read("Drum and bass on my computer keyboard")
	expect(result.answers.contextId).toBe("drum-and-bass")
	expect(result.answers.inputs).toEqual(["screen"])
	expect(result.notes.map((note) => note.text).join(" ")).not.toContain("music keyboard")
})

it("honours negation without losing the rest of the request", () => {
	expect(read("No microphone, I'll use my game controller").answers.inputs).toEqual(["gamepad"])
	expect(read("Not techno, something like dub").answers.contextId).toBe("dub")
	expect(read("Write funk but nothing too fast").answers.pace).toBe("medium")
	expect(read("I can't play guitar but I can sing").answers.inputs).toEqual(["microphone-pitch"])
	expect(read("I can't read music, so read the note names out loud").answers.contextId).toBe(
		"describe-readout"
	)
	expect(read("Techno, and read the note names out loud").answers.feedback).toBe("spoken")
})

it("treats phrases that contain a negation as requests rather than refusals", () => {
	expect(read("Techno without sound, just note names").answers).toMatchObject({
		contextId: "techno",
		feedback: "text"
	})
	expect(read("Funk, but I don't want it silent").answers.feedback).toBe("sound")
	expect(read("Techno, I don't want any sound").answers.feedback).toBe("text")
})

it("separates words about the player from words about the music", () => {
	expect(read("A quick setup for jazz").answers.pace).toBe("suggested")
	expect(read("Fast jazz").answers.pace).toBe("fast")
	expect(read("Funk at my house with drum pads").answers).toMatchObject({
		contextId: "funk",
		inputs: ["pads"]
	})
	expect(read("Write a single finger melody").answers.inputs).toEqual(["screen"])
})

it("explains ambiguous and unsupported parts of the request", () => {
	const keyboard = read("Write a song on my keyboard")
	expect(keyboard.answers.inputs).toEqual(["midi"])
	expect(keyboard.notes.map((note) => note.text).join(" ")).toContain("computer")
	expect(
		read("Remix my MP3")
			.notes.map((note) => note.text)
			.join(" ")
	).toContain("cannot be imported")
	const file = read("Convert my MIDI file using a gamepad")
	expect(file.answers.inputs).toEqual(["screen"])
	expect(file.notes.map((note) => note.text).join(" ")).toContain("not added")
	expect(
		read("Sheet music for techno, and I want to hear it")
			.notes.map((note) => note.text)
			.join(" ")
	).toContain("replaces the instrument sound")
})

it("maps tempo numbers to the activity's own speed or the closest available speed", () => {
	expect(read("Techno at 135 bpm").answers.pace).toBe("suggested")
	const slow = read("Techno at 80 BPM")
	expect(slow.answers.pace).toBe("slow")
	expect(slow.notes.map((note) => note.text).join(" ")).toContain("closest available speed")
	expect(read("Read my MIDI file aloud quickly").answers.pace).toBe("suggested")
})

it("offers alternatives when a description fits more than one activity", () => {
	const result = read("Latin music")
	expect(result.answers.contextId).toBe("salsa")
	expect(result.alternatives.map((item) => item.answers.contextId)).toEqual(
		expect.arrayContaining(["samba"])
	)
	expect(read("Write techno with a heavy minimal groove").confidence).toBe("high")
})

it("reports when nothing could be understood and still returns valid answers", () => {
	for (const text of ["", "asdf qwop", "Not with friends"]) {
		const result = read(text)
		expect(result.matched).toBe(false)
		expect(() => designSetup(result.answers)).not.toThrow()
	}
})

it("matches every style in the wizard by its own name", () => {
	for (const context of wizardContexts("genre")) {
		const name = context.name.replace(/^Write /, "")
		expect(read(`I want ${name}`).answers.contextId, name).toBe(context.id)
	}
	expect(WIZARD_GOALS.length).toBeGreaterThan(0)
})

it("always produces answers the wizard can build", () => {
	const descriptions = [
		"A slow, sad accompaniment I can play with one finger while my class sings along",
		"Fast punk with a webcam and claps, no text",
		"Deaf student wants to see notation on an ipad at 60 bpm",
		"Convert, remix and transcribe my tracker file with friends",
		"Blind DJ mixing techno on a MIDI controller, read the chord names aloud"
	]
	for (const text of descriptions) {
		const result = read(text)
		expect(() => designSetup(result.answers)).not.toThrow()
		for (const alternative of result.alternatives) {
			expect(() => designSetup(alternative.answers)).not.toThrow()
		}
	}
})