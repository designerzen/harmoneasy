import { configurationData } from "audiobus/io/device-definition"
import { createInputById } from "audiobus/io/input-factory"
import { createOutputById } from "audiobus/io/output-factory"
import { importMIDIFile } from "audiobus/importers/import-midi-file"
import {
	hasMidiHeader,
	inspectMediaArchive,
	isArchiveFile,
	isMidiFile,
	MAX_MEDIA_BYTES
} from "audiobus/importers/dropped-media"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type IOChain from "audiobus/io/IO-chain"
import type { ArchivedPlugin } from "audiobus/importers/dropped-media"
import { storeWamArchive } from "./wam-archive"
import { EVENT_CLICK, EVENT_CLOSE } from "audiobus/event-constants"

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
	importScore: (file: File) => Promise<void>
) {
	const target = () => manager.activeChain ?? manager.getChain(manager.createEmptyChain())!
	const loadMidi = async (file: File, chain: IOChain) => {
		const { commands, noteCount } = await importMIDIFile(file)
		if (!noteCount) {
			throw new Error("The MIDI file contains no notes")
		}
		const input = await createInputById("midi-file", {
			...manager.deviceOptions,
			fileName: file.name,
			commands: configurationData(commands.map((command) => ({ ...command })))
		})
		manager.addDevice(chain, input, "input")
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
		if (media.size > MAX_MEDIA_BYTES) {
			throw new Error("Dropped file exceeds the 64 MB limit")
		}
		if (await hasMidiHeader(media)) {
			await loadMidi(media, chain)
			return
		}
		if (isMidiFile(media)) {
			throw new Error("This file does not contain a Standard MIDI File header")
		}
		const signature = new Uint8Array(await media.slice(0, 2).arrayBuffer())
		if (
			isArchiveFile(media) ||
			(signature[0] === 0x50 && signature[1] === 0x4b && !/\.dawproject$/i.test(media.name))
		) {
			const archive = await inspectMediaArchive(new Uint8Array(await media.arrayBuffer()))
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
					await loadMidi(
						new File([new Uint8Array(archive.files[path])], path.split("/").pop()!, {
							type: "audio/midi"
						}),
						chain
					)
				}
			}
			return
		}
		if (/\.(js|mjs|json)$/i.test(media.name)) {
			throw new Error(
				"For WAM plugins, drop a hosted index.js URL or a ZIP containing the complete built plugin and descriptor.json"
			)
		}
		await importScore(media)
	}
}