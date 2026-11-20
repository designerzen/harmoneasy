import { configurationData } from "audiobus/io/device-definition"
import { createInputById } from "audiobus/io/input-factory"
import { createOutputById } from "audiobus/io/output-factory"
import { inspectMediaFiles } from "audiobus/importers/dropped-media"
import {
	detectImportFile,
	importMusicalFile,
	type ImportFormatId
} from "audiobus/importers/file-import"
import type OutputLoopPlayer from "audiobus/io/outputs/output-loop-player"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type IOChain from "audiobus/io/IO-chain"
import type { ArchivedPlugin } from "audiobus/importers/dropped-media"
import { storeWamArchive } from "./wam-archive"
import { EVENT_CLICK, EVENT_CLOSE } from "audiobus/events/event-constants"

async function choosePlugin(plugins: ArchivedPlugin[]): Promise<ArchivedPlugin | undefined> {
	if (plugins.length === 1) {
		return plugins[0]
	}
	const dialog = document.createElement("dialog")
	const title = document.createElement("h2")
	title.textContent = "Choose a WAM2 instrument"
	const select = document.createElement("select")
	select.setAttribute("aria-label", "Instrument in bundle")
	plugins.forEach((plugin, index) => {
		const option = document.createElement("option")
		option.value = String(index)
		option.textContent = plugin.name
		select.append(option)
	})
	const load = document.createElement("button"),
		cancel = document.createElement("button")
	load.textContent = "Load instrument"
	cancel.textContent = "Cancel"
	load.addEventListener(EVENT_CLICK, () => dialog.close("load"))
	cancel.addEventListener(EVENT_CLICK, () => dialog.close())
	dialog.append(title, select, load, cancel)
	document.body.append(dialog)
	return new Promise((resolve) => {
		dialog.addEventListener(
			EVENT_CLOSE,
			() => {
				const selected =
					dialog.returnValue === "load" ? plugins[Number(select.value)] : undefined
				dialog.remove()
				resolve(selected)
			},
			{ once: true }
		)
		dialog.showModal()
	})
}

export function createMediaImporter(
	manager: IOChainManager,
	importScore?: (file: File) => Promise<void>
) {
	const target = () => manager.activeChain ?? manager.getChain(manager.createEmptyChain())!
	const loadNotes = async (file: File, chain: IOChain, format: ImportFormatId = "midi") => {
		const { commands, noteCount } = await importMusicalFile(file, format)
		if (!noteCount) {
			throw new Error("The music file contains no notes")
		}
		const input = await createInputById("midi-file", {
			...manager.deviceOptions,
			fileName: file.name,
			commands: configurationData(commands.map((command) => ({ ...command })))
		})
		manager.addDevice(chain, input, "input")
	}
	const loadAudio = async (file: File, chain: IOChain) => {
		if (file.size > 4 * 1024 * 1024) {
			throw new Error("Audio loops must be at most 4 MB")
		}
		const output = (await createOutputById(
			"loop-player",
			manager.deviceOptions
		)) as OutputLoopPlayer
		try {
			await output.loadSample(await file.arrayBuffer(), file.name)
			await manager.audioContext?.resume()
			manager.addDevice(chain, output, "output")
		} catch (error) {
			await output.destroy?.()
			throw error
		}
	}

	const loadPlugin = async (value: string, chain: IOChain) => {
		let url = new URL(value)
		const legacy = ["legacy:yoshimi", "legacy:dx7"].includes(url.href)
		if (!legacy) {
			if (!["https:", "http:"].includes(url.protocol)) {
				throw new Error("Use an HTTP or HTTPS WAM2 plugin URL")
			}
			if (url.pathname.endsWith("/descriptor.json")) {
				url = new URL("index.js", url)
			} else if (url.pathname.endsWith("/")) {
				url = new URL("index.js", url)
			}
			if (!/\.(m?js)$/i.test(url.pathname)) {
				throw new Error(
					"Drop the plugin index.js URL or its directory URL, rather than a documentation or gallery page"
				)
			}
		}
		const output = await createOutputById(legacy ? "wam" : "wam2", {
			...manager.deviceOptions,
			pluginUrl: url.href
		})
		try {
			await manager.audioContext?.resume()
			await output.connect?.()
			manager.addDevice(chain, output, "output")
		} catch (error) {
			await (output as any).destroy?.()
			throw error
		}
	}

	return async (media: File | string): Promise<void> => {
		// Capture the intended chain before asynchronous parsing, fetching or a picker.
		const chain = target()
		if (typeof media === "string") {
			await loadPlugin(media, chain)
			return
		}
		const detected = await detectImportFile(media)
		if (detected.format.kind === "notes") {
			if (importScore && detected.format.id !== "midi") {
				await importScore(media)
			} else {
				await loadNotes(media, chain, detected.format.id)
			}
			return
		}
		if (detected.format.kind === "audio") {
			await loadAudio(media, chain)
			return
		}
		if (detected.archive) {
			const archive = inspectMediaFiles(detected.archive)
			if (archive.plugins.length) {
				const plugin = await choosePlugin(archive.plugins)
				if (!plugin) {
					return
				}
				const stored = await storeWamArchive(archive.files, plugin.path)
				try {
					await loadPlugin(stored.url, chain)
				} catch (error) {
					await stored.rollback()
					throw error
				}
			} else {
				for (const path of archive.midi) {
					await loadNotes(
						new File([new Uint8Array(archive.files[path])], path.split("/").pop()!, {
							type: "audio/midi"
						}),
						chain
					)
				}
			}
			return
		}
		throw new Error("Expected a ZIP bundle containing MIDI or a complete WAM2 instrument")
	}
}