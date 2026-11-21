import { createOutputById } from "audiobus/io/output-factory"
import { rememberFile, sourceName } from "audiobus/io/outputs/rompler/rompler-source"
import { formatSize } from "audiobus/io/outputs/rompler/rompler-soundfonts"
import { EVENT_CHANGE, EVENT_CLICK, EVENT_CLOSE } from "audiobus/events/event-constants"
import type Rompler from "audiobus/io/outputs/rompler/output-rompler"
import type IOChainManager from "audiobus/io/IO-chain-manager"
import type IOChain from "audiobus/io/IO-chain"

interface Target {
	chain: IOChain
	name: string
	rompler: Rompler
}

const isRompler = (output: unknown): output is Rompler =>
	typeof (output as Rompler)?.setSoundFont === "function"

const chainName = (manager: IOChainManager, chain: IOChain) =>
	chain.options.name || `Chain ${manager.chains.indexOf(chain) + 1}`

/**
 * Asks which Romplers should play a dropped soundfont, offering a new one
 * on the chain in focus. Resolves to the choice, or undefined if cancelled.
 */
function chooseRomplers(
	file: File,
	targets: Target[],
	chain: string
): Promise<{ change: Rompler[]; add: boolean } | undefined> {
	const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
		const node = document.createElement(tag)
		node.textContent = text
		return node
	}
	const dialog = element("dialog")
	dialog.id = "soundfont-dialog"
	dialog.setAttribute("aria-labelledby", "soundfont-dialog-title")
	const header = element("header"),
		title = element("h5", "Load soundfont")
	title.id = "soundfont-dialog-title"
	header.append(title)
	const about = element("p", `${file.name} · ${formatSize(file.size)}`)
	const fieldset = element("fieldset"),
		legend = element("legend", targets.length ? "Play it on" : "No Romplers yet")
	fieldset.append(legend)
	const boxes: { input: HTMLInputElement; rompler?: Rompler }[] = []
	const option = (label: string, detail: string, checked: boolean, rompler?: Rompler) => {
		const row = element("label"),
			input = element("input"),
			text = element("span", label)
		input.type = "checkbox"
		input.checked = checked
		row.className = "soundfont-target"
		row.append(input, text, element("small", detail))
		fieldset.append(row)
		boxes.push({ input, rompler })
	}
	for (const target of targets) {
		option(
			`${target.name} · Rompler`,
			`Now playing ${sourceName(target.rompler.options.soundfont)}`,
			true,
			target.rompler
		)
	}
	option(
		`Add a Rompler to ${chain}`,
		targets.length
			? "Keeps the Romplers above as they are"
			: "Creates a Rompler Output playing this soundfont",
		!targets.length
	)
	const note = element(
		"p",
		"The file is kept in this browser, so these Romplers reopen it next time."
	)
	note.className = "soundfont-note"
	const actions = element("menu"),
		load = element("button", "Load soundfont")
	load.type = "button"
	actions.append(load)
	const closeForm = element("form"),
		cancel = element("button", "Cancel")
	closeForm.method = "dialog"
	cancel.type = "submit"
	closeForm.append(cancel)
	dialog.append(header, about, fieldset, note, actions, closeForm)
	document.body.append(dialog)

	const update = () => {
		load.disabled = !boxes.some(({ input }) => input.checked)
	}
	fieldset.addEventListener(EVENT_CHANGE, update)
	update()
	load.addEventListener(EVENT_CLICK, () => dialog.close("load"))
	return new Promise((resolve) => {
		dialog.addEventListener(
			EVENT_CLOSE,
			() => {
				const chosen = dialog.returnValue === "load"
				dialog.remove()
				resolve(
					chosen
						? {
								change: boxes
									.filter(({ input, rompler }) => input.checked && rompler)
									.map(({ rompler }) => rompler!),
								add: boxes.some(({ input, rompler }) => input.checked && !rompler)
							}
						: undefined
				)
			},
			{ once: true }
		)
		dialog.showModal()
		load.focus()
	})
}

/** Plays a dropped soundfont on the Romplers the player picks, adding one if asked */
export async function loadSoundFont(
	manager: IOChainManager,
	file: File,
	chain: IOChain
): Promise<void> {
	const targets = manager.chains.flatMap((owner) =>
		owner.outputs
			.filter(isRompler)
			.map((rompler) => ({ chain: owner, name: chainName(manager, owner), rompler }))
	)
	const choice = await chooseRomplers(file, targets, chainName(manager, chain))
	if (!choice) {
		return
	}
	// Stored once; every Rompler then shares one parsed copy of the file
	const key = await rememberFile(file)
	await Promise.all(choice.change.map((rompler) => rompler.setSoundFont(key)))
	if (choice.add) {
		const output = (await createOutputById("rompler", {
			...manager.deviceOptions,
			soundfont: key
		})) as Rompler
		try {
			await manager.audioContext?.resume()
			manager.addDevice(chain, output, "output")
			await output.connect()
		} catch (error) {
			output.destroy()
			throw error
		}
	}
}