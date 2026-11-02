import { afterEach, expect, it, vi } from "vitest"
import OPFSStorage from "../../../packages/audiobus/storage/opfs-storage"
import { encodeAudioCommand } from "../../../packages/audiobus/audio-command-encoder"
import { createAudioCommand } from "../../../packages/audiobus/audio-command-factory"
import { NOTE_ON } from "../../../packages/audiobus/commands"
import { OPFS_MESSAGE_TYPE_READ } from "../../../packages/audiobus/storage/opfs-constants"

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

it("recovers valid commands on either side of a damaged MessagePack record", async () => {
	const first = createAudioCommand(NOTE_ON, 60, 0, "test")
	const last = createAudioCommand(NOTE_ON, 64, 1, "test")
	const commands = [first, last].map((command) => Array.from(encodeAudioCommand(command)))
	commands.splice(1, 0, [0xdf]) // Map header missing its length, as in a truncated record.
	vi.stubGlobal("navigator", { storage: { getDirectory: vi.fn() } })
	vi.stubGlobal(
		"Worker",
		class {
			onmessage?: (event: { data: unknown }) => void
			postMessage({ type, id }: { type: string; id: string }) {
				queueMicrotask(() =>
					this.onmessage?.({
						data: {
							id,
							success: true,
							...(type === OPFS_MESSAGE_TYPE_READ ? { commands } : {})
						}
					})
				)
			}
			terminate() {}
		}
	)
	const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
	const error = vi.spyOn(console, "error").mockImplementation(() => {})
	const storage = new OPFSStorage()
	expect(await storage.prepare()).toBe(true)
	const recovered = await storage.readAll()
	expect(recovered.map(({ number }) => number)).toEqual([60, 64])
	expect(warning).toHaveBeenCalledWith("Skipped 1 unreadable saved audio command(s).")
	expect(error).not.toHaveBeenCalled()
	storage.dispose()
})