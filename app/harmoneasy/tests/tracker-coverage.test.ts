import { expect, it } from "vitest"
import { File as NodeFile } from "node:buffer"
import { readFileSync } from "node:fs"
import {
	TRACKER_EXTENSIONS,
	getSupportedTrackerExtensions,
	importTrackerFile
} from "audiobus/importers/import-tracker-file"
import {
	detectImportFile,
	IMPORT_FILE_ACCEPT,
	FILE_IMPORT_FORMATS
} from "audiobus/importers/file-import"
import { EXPORT_FORMATS } from "audiobus/exporters/registry"
import { AUDIO_EXPORT_FORMATS } from "audiobus/io/media/audio-media"
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands"

it("decodes a native MultiTracker module into timed note pairs", async () => {
	// MTM: 66-byte header, 128 orders, one 192-byte track, 64-byte pattern map.
	const data = new Uint8Array(450),
		view = new DataView(data.buffer)
	data.set(new TextEncoder().encode("MTM"))
	data[3] = 0x10
	view.setUint16(24, 1, true)
	data[32] = 64
	data[33] = 1
	data.fill(8, 34, 66)
	data.set([24 << 2, 0x0f, 0], 194)
	data.set([26 << 2, 0x0f, 0], 197)
	view.setUint16(386, 1, true)
	const result = await importTrackerFile(new NodeFile([data], "song.mtm") as unknown as File)
	const notes = result.commands.filter((command) => command.type === NOTE_ON)
	expect(result.noteCount).toBe(2)
	expect(notes[1].number - notes[0].number).toBe(2)
	expect(notes[1].startAt).toBeGreaterThan(notes[0].startAt)
	expect(result.commands.filter((command) => command.type === NOTE_OFF)).toHaveLength(2)
})

it("exposes every format actually supported by the bundled tracker decoder", async () => {
	expect([...TRACKER_EXTENSIONS].sort()).toEqual((await getSupportedTrackerExtensions()).sort())
	for (const extension of TRACKER_EXTENSIONS) {
		expect(IMPORT_FILE_ACCEPT.split(",")).toContain(`.${extension}`)
		expect(
			(
				await detectImportFile(
					new NodeFile(["module"], `song.${extension}`) as unknown as File
				)
			).format.id
		).toBe("tracker")
	}
})

it.each([
	"DBM0",
	"DMDL",
	"PTMF",
	"PSM ",
	"MT20",
	"IM10",
	"XPKF",
	"MTM",
	"MO3",
	"AMF",
	"OKTASONG",
	"ziRCONia",
	"RIFF0000DSMF"
])("recognises the %s tracker signature without a filename hint", async (signature) => {
	expect(
		(await detectImportFile(new NodeFile([signature], "unknown.bin") as unknown as File)).format
			.id
	).toBe("tracker")
})

it.each(["PSM", "FAR", "GDM"])("recognises binary %s signatures", async (prefix) => {
	const bytes = new Uint8Array([...new TextEncoder().encode(prefix), 0xfe])
	expect(
		(await detectImportFile(new NodeFile([bytes], "unknown.bin") as unknown as File)).format.id
	).toBe("tracker")
})

it.each(["mod.song", "MED.My song", "xm.song"])(
	"accepts traditional format prefixes in %s",
	async (name) => {
		expect(
			(await detectImportFile(new NodeFile(["module"], name) as unknown as File)).format.id
		).toBe("tracker")
	}
)

it("documents every registered import, musical export and audio export extension", () => {
	const readme = readFileSync("../../README.md", "utf8").toLowerCase()
	for (const format of [...FILE_IMPORT_FORMATS, ...EXPORT_FORMATS, ...AUDIO_EXPORT_FORMATS]) {
		const extensions = "extensions" in format ? format.extensions : [format.extension]
		for (const extension of extensions) {
			expect(readme).toContain(`\`.${extension.toLowerCase()}\``)
		}
	}
})