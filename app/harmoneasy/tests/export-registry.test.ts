// @vitest-environment happy-dom
import { expect, it } from "vitest"
import AudioCommand from "audiobus/commands/audio-command"
import AudioEvent from "audiobus/models/audio-event"
import { NOTE_ON } from "audiobus/commands/commands"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { EXPORT_FORMATS, getExportFormat } from "audiobus/exporters/registry"
import {
	saveExportToLocalFileSystem,
	saveScoreToLocalFileSystem
} from "audiobus/exporters/download-score"
import { vi } from "vitest"

// Multiple channels, with sequential notes so monophonic formats can export the same fixture.
const recording = {
	name: "Registry fixture",
	duration: 12,
	events: [
		[60, 1, 3, 90, 10],
		[64, 2, 5, 64, 11]
	].map(
		([number, channel, patch, velocity, start]) =>
			new AudioEvent(
				Object.assign(new AudioCommand(), {
					type: NOTE_ON,
					number,
					channel,
					patch,
					velocity,
					endAt: start + 0.5
				}),
				start
			)
	)
}
it("provides unique ids and extensions and resolves every registered format", () => {
	expect(new Set(EXPORT_FORMATS.map((format) => format.id)).size).toBe(EXPORT_FORMATS.length)
	expect(new Set(EXPORT_FORMATS.map((format) => format.extension.toLowerCase())).size).toBe(
		EXPORT_FORMATS.length
	)
	for (const format of EXPORT_FORMATS) {
		expect(getExportFormat(format.id)).toBe(format)
	}
	expect(getExportFormat("missing")).toBeUndefined()
	expect(getExportFormat("midi")?.extension).toBe("mid")
})
for (const format of EXPORT_FORMATS) {
	if (
		format.kind === "tracker" &&
		!existsSync(resolve("../../packages/audiobus/exporters/adapter-tracker.ts"))
	) {
		it.skip(`exports ${format.id}: tracker adapter has not been created yet`, () => {})
		continue
	}
	it(`exports ${format.id} to a non-empty Blob`, async () => {
		const original = JSON.stringify(recording)
		const blob = await format.export(recording, { BPM: 120 })
		expect(blob).toBeInstanceOf(Blob)
		expect(blob.size).toBeGreaterThan(0)
		expect(blob.type).toBe(format.mime)
		expect(JSON.stringify(recording)).toBe(original)
	})
}
it("downloads using the registered extension without appending it twice", () => {
	const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
		expect(this.download).toBe("Song.MID")
	})
	const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test")
	const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
	try {
		expect(saveScoreToLocalFileSystem).toBe(saveExportToLocalFileSystem)
		saveExportToLocalFileSystem(new Blob(["test"]), "Song.MID", "mid")
		expect(click).toHaveBeenCalledOnce()
		expect(revoke).toHaveBeenCalledWith("blob:test")
		expect(document.querySelector('a[href="blob:test"]')).toBeNull()
	} finally {
		click.mockRestore()
		create.mockRestore()
		revoke.mockRestore()
	}
})