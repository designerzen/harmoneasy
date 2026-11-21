// @vitest-environment happy-dom
import { expect, it } from "vitest"
import { File } from "node:buffer"
import { createRequire } from "node:module"
import { resolve } from "node:path"
const { zipSync, strToU8 } = createRequire(resolve("../../packages/audiobus/package.json"))(
	"fflate"
)
import { importMusicXMLFile } from "audiobus/importers/import-musicxml-import"
import { importDawProjectFile } from "audiobus/importers/import-dawproject"
import { importTrackerFile } from "audiobus/importers/import-tracker-file"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands"

const file = (data: string | Uint8Array, name: string) =>
	new File([data], name) as unknown as globalThis.File
const xml = `<score-partwise version="4.0"><part-list/><part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes><direction><sound tempo="120"/></direction>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>
<note><rest/><duration>2</duration></note>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration></note>
</measure></part><part id="P2"><measure><attributes><divisions>1</divisions></attributes>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration></note>
</measure></part></score-partwise>`
const mxl = (root = "scores/score.musicxml") =>
	zipSync({
		"META-INF/container.xml": strToU8(
			`<container><rootfiles><rootfile full-path="${root}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`
		),
		"scores/score.musicxml": strToU8(xml)
	})
it("loads the declared MXL root with chords, rests, divisions and simultaneous parts", async () => {
	const result = await importMusicXMLFile(file(mxl(), "song.mxl"))
	expect(result.noteCount).toBe(4)
	const notes = result.commands.filter((c) => c.type === NOTE_ON)
	expect(notes.map((c) => [c.number, c.startAt, c.endAt])).toEqual([
		[60, 0, 0.5],
		[64, 0, 0.5],
		[48, 0, 0.5],
		[67, 1, 1.5]
	])
	expect(result.commands.filter((c) => c.type === NOTE_OFF)).toHaveLength(4)
})
it("rejects missing, unsafe and malformed MXL roots", async () => {
	await expect(importMusicXMLFile(file(mxl("missing.xml"), "song.mxl"))).rejects.toThrow(
		"missing its root score"
	)
	await expect(importMusicXMLFile(file(mxl("../score.xml"), "song.mxl"))).rejects.toThrow(
		"Unsafe archive path"
	)
	await expect(
		importMusicXMLFile(file(zipSync({ "score.xml": strToU8(xml) }), "song.mxl"))
	).rejects.toThrow("container.xml")
	await expect(importMusicXMLFile(file("<bad>", "score.xml"))).rejects.toThrow()
})
const project = (content: string) =>
	file(
		zipSync({
			"project.xml": strToU8(
				`<Project version="1.0"><Transport><Tempo value="120"/></Transport><Arrangement><Lanes timeUnit="beats">${content}</Lanes></Arrangement></Project>`
			)
		}),
		"song.dawproject"
	)
it("reads standard DAWproject XML, clip offsets, playStart, loops and normalized velocities", async () => {
	const result = await importDawProjectFile(
		project(`<Lanes track="track1"><Clips><Clip time="4" duration="6" playStart="1" loopStart="0" loopEnd="2"><Notes>
	<Note time="1" duration="0.5" channel="0" key="60" vel="0.5"/>
	</Notes></Clip></Clips></Lanes>`)
	)
	expect(result.noteCount).toBe(3)
	expect(
		result.commands
			.filter((c) => c.type === NOTE_ON)
			.map((c) => [c.number, c.startAt, c.endAt, c.velocity])
	).toEqual([
		[60, 2, 2.25, 64],
		[60, 3, 3.25, 64],
		[60, 4, 4.25, 64]
	])
})
it("inherits seconds for DAWproject notes and clips to the region", async () => {
	const result = await importDawProjectFile(
		project(
			`<Clips timeUnit="seconds"><Clip time="3" duration="1"><Notes><Note time="0.5" duration="2" key="0" channel="1" vel="0"/></Notes></Clip></Clips>`
		)
	)
	expect(result.commands[0]).toMatchObject({
		startAt: 3.5,
		endAt: 4,
		number: 0,
		channel: 2,
		velocity: 0
	})
})
it("rejects nonstandard DAWproject archives and empty arrangements", async () => {
	await expect(
		importDawProjectFile(file(zipSync({ "other.xml": strToU8(xml) }), "song.dawproject"))
	).rejects.toThrow("missing project.xml")
	await expect(importDawProjectFile(project(""))).rejects.toThrow("no importable notes")
})
function mod() {
	const data = new Uint8Array(1084 + 1024)
	data.set(strToU8("M.K."), 1080)
	data[950] = 2 // Repeat pattern zero in the order list.
	data[45] = 64 // Sample 1 default volume.
	// C-2 (period 428), sample 1, on row 0, then D-2 on row 2.
	data.set([1, 0xac, 0x10, 0], 1084)
	data.set([1, 0x7d, 0x10, 0], 1084 + 32)
	return data
}
it("imports real MOD periods, rows and repeated order entries through WASM", async () => {
	const result = await importTrackerFile(file(mod(), "song.mod"))
	expect(result.noteCount).toBe(4)
	const notes = result.commands.filter((c) => c.type === NOTE_ON)
	expect(notes.map((c) => c.number)).toEqual([60, 62, 60, 62])
	expect(notes[0].startAt).toBe(0)
	expect(notes[1].startAt).toBeCloseTo(0.24, 2)
	expect(notes[2].startAt).toBeCloseTo(7.68, 2)
	expect(notes[0].channel).toBe(1)
	expect(notes[0].velocity).toBe(127)
	expect(result.commands.filter((c) => c.type === NOTE_OFF)).toHaveLength(4)
}, 20000)
it("rejects invalid tracker content instead of succeeding with no notes", async () => {
	await expect(importTrackerFile(file("not a module", "song.it"))).rejects.toThrow(
		"Invalid or unsupported"
	)
})

function trackerFixture(format: string, channels = 1) {
	const data = new Uint8Array(1200),
		view = new DataView(data.buffer)
	const u16 = (at: number, value: number) => view.setUint16(at, value, true)
	const u32 = (at: number, value: number) => view.setUint32(at, value, true)
	if (format === "xm") {
		data.set(strToU8("Extended Module: "))
		data[37] = 0x1a
		u16(58, 0x104)
		u32(60, 276)
		u16(64, 1)
		u16(68, channels)
		u16(70, 1)
		u16(76, 6)
		u16(78, 125)
		u32(336, 9)
		u16(341, 2)
		u16(343, channels * 10)
		for (let channel = 0; channel < channels; channel++) {
			data.set([49, 0, 0x50, 0, 0], 345 + channel * 5)
			data.set([51, 0, 0x50, 0, 0], 345 + (channels + channel) * 5)
		}
	} else if (format === "it") {
		data.set(strToU8("IMPM"))
		u16(32, 1)
		u16(38, 1)
		u16(40, 0x214)
		u16(42, 0x214)
		data[48] = 128
		data[49] = 48
		data[50] = 6
		data[51] = 125
		data.fill(255, 64, 128)
		data[64] = 32
		data.fill(64, 128, 192)
		u32(193, 256)
		u16(256, 9)
		u16(258, 2)
		data.set([129, 5, 60, 64, 0, 129, 1, 62, 0], 264)
	} else if (format === "s3m") {
		data[28] = 0x1a
		data[29] = 16
		u16(32, 2)
		u16(36, 1)
		u16(40, 0x1320)
		u16(42, 2)
		data.set(strToU8("SCRM"), 44)
		data[48] = 64
		data[49] = 6
		data[50] = 125
		data.fill(255, 64, 96)
		data[64] = 0
		data[97] = 255
		u16(98, 16)
		u16(256, 70)
		data.set([0x60, 0x40, 0, 64, 0, 0x20, 0x42, 0, 0], 258)
	} else {
		// MMD0 OctaMED: one sample table, one block and a two-row pattern.
		data.set(strToU8("MMD0"))
		view.setUint32(4, data.length)
		view.setUint32(8, 52)
		view.setUint32(16, 900)
		const song = 52 + 63 * 8
		view.setUint16(song, 1)
		view.setUint16(song + 2, 1)
		view.setUint16(song + 260, 125)
		data[song + 265] = 6
		data[song + 264] = 0x20
		data[song + 282] = 64
		view.setUint32(900, 920)
		data[920] = 1
		data[921] = 1
		data.set([25, 0, 0, 27, 0, 0], 922)
	}
	return data
}
for (const format of ["xm", "it", "s3m", "med"]) {
	it(`extracts notes from a ${format.toUpperCase()} binary module`, async () => {
		const result = await importTrackerFile(file(trackerFixture(format), `song.${format}`))
		const notes = result.commands.filter((c) => c.type === NOTE_ON)
		expect(result.noteCount).toBe(2)
		expect(notes[1].number - notes[0].number).toBe(2)
		expect(notes[1].startAt).toBeGreaterThan(0)
	})
}
it("imports 32-track modules with paired note endings and separate track sources", async () => {
	const result = await importTrackerFile(file(trackerFixture("xm", 32), "song.xm"))
	const notes = result.commands.filter((command) => command.type === NOTE_ON)
	expect(result.noteCount).toBe(64)
	expect(new Set(notes.map((command) => command.from)).size).toBe(32)
	expect(notes.every((command) => command.channel >= 1 && command.channel <= 16)).toBe(true)
	for (const note of notes) {
		expect(result.commands).toContainEqual(
			expect.objectContaining({
				type: NOTE_OFF,
				from: note.from,
				channel: note.channel,
				number: note.number,
				startAt: note.endAt
			})
		)
	}
})
it("applies MusicXML tempo changes and backup voices to note timestamps", async () => {
	const score = `<score-partwise><part><measure><attributes><divisions>2</divisions></attributes>
	<direction><sound tempo="120"/><direction-type><dynamics><p/></dynamics></direction-type></direction>
	<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
	<direction><sound tempo="60"/></direction>
	<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration></note>
	<backup><duration>4</duration></backup>
	<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note>
	</measure></part></score-partwise>`
	const result = await importMusicXMLFile(file(score, "song.musicxml"))
	expect(
		result.commands
			.filter((c) => c.type === NOTE_ON)
			.map((c) => [c.number, c.startAt, c.endAt, c.velocity])
	).toEqual([
		[60, 0, 0.5, 49],
		[64, 0, 1.5, 49],
		[62, 0.5, 1.5, 49]
	])
})
it("follows MOD speed changes when computing row timestamps", async () => {
	const data = mod()
	data.set([0, 0, 0x0f, 3], 1088) // F03: three ticks per row.
	const result = await importTrackerFile(file(data, "speed.mod"))
	const notes = result.commands.filter((c) => c.type === NOTE_ON)
	expect(notes[1].startAt).toBeCloseTo(0.12, 2)
	expect(notes[2].startAt).toBeCloseTo(3.84, 2)
})