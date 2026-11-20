// @vitest-environment happy-dom
import { expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
import {
	detectImportFile,
	importMusicalFile,
	IMPORT_FILE_ACCEPT
} from "audiobus/importers/file-import"
import { exportInterchangeRecording } from "audiobus/exporters/adapter-interchange"
import { encodeLMMSContainer, decodeLMMSContainer } from "audiobus/formats/lmms-container"
import { projectTimeAxis } from "audiobus/formats/project-time"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON } from "audiobus/commands/commands"

const file = (data: string | Uint8Array, name = "renamed.bin") =>
	new NodeFile([data], name) as unknown as File
const onNotes = (result: Awaited<ReturnType<typeof importMusicalFile>>) =>
	result.commands.filter((command) => command.type === NOTE_ON)

it("integrates tempo changes across a note in UtaFormatix data", async () => {
	const input = file(
		JSON.stringify({
			formatVersion: 1,
			project: {
				tempos: [
					{ tickPosition: 480, bpm: 60 },
					{ tickPosition: 0, bpm: 120 }
				],
				tracks: [{ notes: [{ key: 60, tickOn: 240, tickOff: 960, lyric: "a" }] }]
			}
		})
	)
	expect((await detectImportFile(input)).format.id).toBe("ufdata")
	expect(onNotes(await importMusicalFile(input))[0]).toMatchObject({
		number: 60,
		startAt: 0.25,
		endAt: 1.5
	})
})

const ustx = `name: Test
ustx_version: '0.6'
resolution: 480
tempos:
- {position: 0, bpm: 120}
- {position: 480, bpm: 60}
tracks: [{}]
voice_parts:
- position: 240
  track_no: 0
  notes:
  - {position: 240, duration: 480, tone: 64, lyric: a}
wave_parts: []
`
it("loads YAML USTX with part offsets and tempo changes", async () => {
	const input = file(ustx)
	expect((await detectImportFile(input)).format.id).toBe("ustx")
	expect(onNotes(await importMusicalFile(input))[0]).toMatchObject({
		number: 64,
		startAt: 0.5,
		endAt: 1.5
	})
})

it("loads Synthesizer V library groups with repeated instances and transposition", async () => {
	const input = file(
		JSON.stringify({
			version: 113,
			time: {
				tempo: [
					{ position: 0, bpm: 120 },
					{ position: 705600000, bpm: 60 }
				]
			},
			library: [{ uuid: "phrase", notes: [{ onset: 0, duration: 705600000, pitch: 60 }] }],
			tracks: [
				{
					groups: [
						{ groupID: "phrase", blickOffset: 0, pitchOffset: 0 },
						{ groupID: "phrase", blickOffset: 705600000, pitchOffset: 4 }
					]
				}
			]
		}) + "\0"
	)
	expect((await detectImportFile(input)).format.id).toBe("svp")
	expect(onNotes(await importMusicalFile(input))).toEqual([
		expect.objectContaining({ number: 60, startAt: 0, endAt: 0.5 }),
		expect.objectContaining({ number: 64, startAt: 0.5, endAt: 1.5 })
	])
})

it("uses the newest Synthesizer V compatibility copy", async () => {
	const project = (version: number, pitch: number) =>
		JSON.stringify({
			version,
			time: { tempo: [{ position: 0, bpm: 120 }] },
			tracks: [
				{ mainGroup: { notes: [{ pitch, onset: 0, duration: 705600000 }] }, mainRef: {} }
			]
		})
	const input = file(`${project(100, 60)}\0${project(113, 64)}\0`)
	expect((await detectImportFile(input)).format.id).toBe("svp")
	expect(onNotes(await importMusicalFile(input))[0].number).toBe(64)
})

const mmp = `<?xml version="1.0"?><!DOCTYPE multimedia-project><multimedia-project type="song"><head bpm="120" masterpitch="2"/><song><trackcontainer><track type="0"><instrumenttrack basenote="57"><midiport outputchannel="3" outputprogram="8"/></instrumenttrack><pattern pos="48" type="1"><note key="48" pos="24" len="48" vol="100"/></pattern><pattern pos="0" muted="1"><note key="50" pos="0" len="48" vol="100"/></pattern></track><track type="0" muted="1"><pattern pos="0"><note key="55" pos="0" len="48" vol="100"/></pattern></track></trackcontainer></song></multimedia-project>`
it("loads LMMS song patterns with transpose, offsets and MIDI routing", async () => {
	const input = file(mmp)
	expect((await detectImportFile(input)).format.id).toBe("lmms")
	expect(onNotes(await importMusicalFile(input))).toEqual([
		expect.objectContaining({
			number: 62,
			startAt: 0.75,
			endAt: 1.25,
			channel: 3,
			patch: 7,
			velocity: 64
		})
	])
})

it("detects and loads Qt-compressed LMMS content without relying on a filename", async () => {
	const input = file(encodeLMMSContainer(mmp))
	expect((await detectImportFile(input)).format.id).toBe("lmms-compressed")
	expect(onNotes(await importMusicalFile(input))[0]).toMatchObject({
		number: 62,
		startAt: 0.75,
		endAt: 1.25
	})
})

for (const format of ["svp", "ustx", "ufdata", "lmms", "lmms-compressed"] as const) {
	it(`preserves overlapping note timing when exporting ${format}`, async () => {
		const events = [
			{ number: 60, startAt: 10, endAt: 11 },
			{ number: 64, startAt: 10.5, endAt: 11.5 },
			{ number: 67, startAt: 12, endAt: 12.25 }
		].map(
			(note) =>
				new AudioEvent(
					Object.assign(new AudioCommand(), {
						...note,
						type: NOTE_ON,
						velocity: 100,
						channel: 1,
						patch: 0
					}),
					note.startAt
				)
		)
		const recording = { events, duration: 13, name: "Project <test>" }
		const original = JSON.stringify(recording)
		const blob = await exportInterchangeRecording(recording, { BPM: 120 }, format)
		const result = await importMusicalFile(file(new Uint8Array(await blob.arrayBuffer())))
		expect(result.noteCount).toBe(3)
		expect(onNotes(result)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ number: 60, startAt: 0, endAt: 1 }),
				expect.objectContaining({ number: 64, startAt: 0.5, endAt: 1.5 }),
				expect.objectContaining({ number: 67, startAt: 2, endAt: 2.25 })
			])
		)
		expect(JSON.stringify(recording)).toBe(original)
	})
}

for (const [index, text] of [
	JSON.stringify({ formatVersion: 2, project: { tracks: [], tempos: [] } }),
	JSON.stringify({
		formatVersion: 1,
		project: { tempos: [{ tickPosition: 0, bpm: 0 }], tracks: [] }
	}),
	JSON.stringify({
		formatVersion: 1,
		project: { tempos: [], tracks: [{ notes: [{ key: 128, tickOn: 0, tickOff: 480 }] }] }
	}),
	JSON.stringify({ version: 113, time: {}, tracks: [{ groups: [{ groupID: "missing" }] }] }),
	ustx.replace("duration: 480", "duration: -1"),
	ustx.replace("tone: 64", "tone: 128"),
	ustx
		.replace("tracks: [{}]", "tracks: &ref [{track_name: Voice}]")
		.replace("wave_parts: []", "wave_parts: *ref"),
	mmp.replace('len="48"', 'len="-192"'),
	mmp.replace('bpm="120"', 'bpm="0"'),
	'<!DOCTYPE lmms-project [<!ENTITY x SYSTEM "file:///secret">]><lmms-project/>'
].entries()) {
	it(`rejects malformed or unsupported project data ${index}`, async () => {
		await expect(importMusicalFile(file(text))).rejects.toThrow()
	})
}

it("rejects LMMS tempo automation instead of importing incorrect timings", async () => {
	const xml = mmp
		.replace('bpm="120"', "")
		.replace("<head ", "<head ")
		.replace(
			"/><song>",
			'><bpm value="120" id="8"/></head><song><automationpattern><object id="8"/></automationpattern>'
		)
	await expect(importMusicalFile(file(xml))).rejects.toThrow("tempo automation")
})

it("bounds expanded LMMS data and rejects wrong size headers", () => {
	const bytes = encodeLMMSContainer(mmp)
	new DataView(bytes.buffer).setUint32(0, 65 * 1024 * 1024)
	expect(() => decodeLMMSContainer(bytes)).toThrow("64 MB")
	new DataView(bytes.buffer).setUint32(0, 1)
	expect(() => decodeLMMSContainer(bytes)).toThrow("expanded size")
})

it("rejects corrupt or truncated LMMS compression trailers", () => {
	const bytes = encodeLMMSContainer(mmp)
	bytes[bytes.length - 1] ^= 1
	expect(() => decodeLMMSContainer(bytes)).toThrow("checksum")
	expect(() => decodeLMMSContainer(bytes.slice(0, -3))).toThrow()
})

it("validates project tempo positions and resolution", () => {
	expect(() => projectTimeAxis(0, [])).toThrow("resolution")
	expect(() => projectTimeAxis(480, [{ position: -1, bpm: 120 }])).toThrow("ticks")
})

it("includes the project extensions in the unified picker", () => {
	for (const extension of [".svp", ".ustx", ".ufdata", ".mmp", ".mmpz", ".mpt"]) {
		expect(IMPORT_FILE_ACCEPT.split(",")).toContain(extension)
	}
})
