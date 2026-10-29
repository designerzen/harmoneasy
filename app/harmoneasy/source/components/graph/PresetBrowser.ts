import type IOChainManager from "audiobus/io/IO-chain-manager"
import type { TransformerPreset, PresetSetup, PresetLibrary } from "audiobus/io/preset-library"
import { EVENT_PRESET_LIBRARY_UPDATED, EVENT_STORAGE } from "audiobus/event-constants"
import { createPresetDetails } from "./PresetDetails"
import { createPresetArtwork } from "./PresetArtwork"
import { completePresets, presetContext } from "./preset-catalogue"
import { START_CONTEXTS } from "../../services/start-context-catalogue"
import {
	applySetup,
	deleteLibraryItem,
	downloadLibrary,
	exportLibrary,
	importLibrary,
	readLibrary,
	saveSetup,
	updatePreset,
	writeLibrary
} from "./saved-presets"
import { element, button, option } from "./dom"

export interface PresetBrowserOptions {
	manager?: IOChainManager
	onApply: (preset: TransformerPreset) => void | Promise<void>
	createChain?: boolean
	hideTrigger?: boolean
	startup?: boolean
	onChooseSetup?: (setup: PresetSetup) => void | Promise<void>
}

export function createPresetBrowser({
	manager,
	onApply,
	createChain = false,
	hideTrigger = false,
	startup = false,
	onChooseSetup
}: PresetBrowserOptions) {
	let library: PresetLibrary = {
		format: "harmoneasy-preset-library",
		version: 1,
		presets: [],
		setups: []
	}
	let storageError = "",
		selection = "",
		message = "",
		undo: string | null = null
	let busy = false,
		destroyed = false
	let editor: { kind: "presets" | "setups"; id: string; json: string } | null = null
	const host = element(
		startup ? "section" : "button",
		startup ? "preset-browser preset-browser-inline" : ""
	)
	const dialog = startup ? null : element("dialog", "preset-browser")
	const surface = dialog ?? host
	const titleId = `preset-title-${crypto.randomUUID()}`
	surface.setAttribute("aria-labelledby", titleId)
	const close = () => dialog?.close()
	const header = element("header")
	const heading = element("div")
	const title = element("h2", "", "Find your next sound")
	title.id = titleId
	heading.append(
		title,
		element(
			"p",
			"",
			createChain
				? "Choose a preset for your new chain, or start with a blank chain."
				: "Choose a preset, explore its pattern, then apply it to your chain."
		)
	)
	header.append(heading)
	if (!startup) {
		const dismiss = button("Close", close)
		dismiss.setAttribute("aria-label", "Close presets")
		header.append(dismiss)
	}
	const scroll = element("div", "preset-browser-scroll")
	const toolbar = element("div", "preset-browser-toolbar")
	const run = (action: () => void) => {
		try {
			action()
		} catch (error) {
			message = error instanceof Error ? error.message : String(error)
		}
		render()
	}
	const perform = async (action: () => void | Promise<void>) => {
		if (busy || destroyed) {
			return
		}
		busy = true
		render()
		try {
			const result = action()
			if (result) {
				await result
			}
			close()
		} catch (error) {
			message = error instanceof Error ? error.message : String(error)
		} finally {
			busy = false
			if (!destroyed) {
				render()
			}
		}
	}
	if (createChain && !startup) {
		toolbar.append(
			button(
				"Create blank chain",
				() =>
					void perform(() =>
						onApply({
							id: "",
							name: "Blank chain",
							category: "",
							description: "",
							useCase: "",
							steps: []
						})
					)
			)
		)
	}
	const searchLabel = element("label", "preset-search")
	const search = element("input")
	search.type = "search"
	search.placeholder = "Search sounds, moods or ideas…"
	search.autofocus = startup
	searchLabel.append(element("span", "sr-only", "Search presets"), search)
	const makeFilter = (name: string, all: string) => {
		const label = element("label", "preset-filter")
		const select = element("select")
		select.append(option(all, ""))
		label.append(element("span", "", name), select)
		toolbar.append(label)
		select.onchange = () => render()
		return select
	}
	toolbar.append(searchLabel)
	const category = makeFilter("Preset type", "All preset types")
	const genre = makeFilter("Genre", "All genres")
	for (const context of START_CONTEXTS.filter((item) => item.category === "Genres")) {
		genre.append(option(context.name.replace(/^Write /, ""), context.id))
	}
	search.oninput = () => render()
	const tools = element("details", "preset-library-tools")
	tools.append(element("summary", "", "Library options"))
	const toolActions = element("div", "preset-library-actions")
	const fileInput = element("input", "sr-only")
	fileInput.type = "file"
	fileInput.accept = ".json,application/json"
	fileInput.setAttribute("aria-label", "Import preset library")
	fileInput.onchange = async () => {
		const file = fileInput.files?.[0]
		if (!file || busy) {
			return
		}
		busy = true
		render()
		try {
			if (file.size > 10 * 1024 * 1024) {
				throw new Error("Choose a JSON file smaller than 10 MB")
			}
			importLibrary(await file.text())
			message = "Imported into your library. Your playing workspace has not changed."
			undo = null
		} catch (error) {
			message = error instanceof Error ? error.message : String(error)
		} finally {
			fileInput.value = ""
			busy = false
			if (!destroyed) {
				render()
			}
		}
	}
	const saveForm = element("form", "preset-setup-save")
	saveForm.hidden = true
	const setupName = element("input")
	setupName.required = true
	setupName.maxLength = 80
	const setupLabel = element("label", "", "Setup name ")
	setupLabel.append(setupName)
	const saveSetupButton = element("button", "", "Save setup")
	saveSetupButton.type = "submit"
	saveForm.append(
		setupLabel,
		saveSetupButton,
		button("Cancel", () => {
			saveForm.hidden = true
		})
	)
	saveForm.onsubmit = (event) => {
		event.preventDefault()
		if (manager) {
			run(() => {
				const item = saveSetup(manager, setupName.value)
				selection = `setup:${item.id}`
				saveForm.hidden = true
				undo = null
				message = "Setup saved to your library. Use Save selected to download it."
			})
		}
	}
	toolActions.append(
		button("Save library to file", () => run(() => downloadLibrary(exportLibrary()))),
		button("Import JSON file", () => fileInput.click()),
		fileInput,
		button("New preset", () => {
			const item: TransformerPreset = {
				id: crypto.randomUUID(),
				name: "New preset",
				category: "My presets",
				description: "",
				useCase: "",
				steps: []
			}
			editor = { kind: "presets", id: item.id, json: JSON.stringify(item, null, 2) }
			message = ""
			render()
		})
	)
	if (manager) {
		toolActions.append(
			button("Save current setup", () => {
				setupName.value = "My setup"
				saveForm.hidden = false
				setupName.focus()
			})
		)
	}
	const undoButton = button("Undo delete", () =>
		run(() => {
			if (undo) {
				importLibrary(undo)
			}
			undo = null
			message = "Deletion undone."
		})
	)
	toolActions.append(undoButton)
	tools.append(
		toolActions,
		element(
			"p",
			"preset-library-note",
			"Saved in this browser. Export your library to keep a portable copy; imports are added to your existing presets."
		)
	)
	toolbar.append(tools)
	const status = element("p", "preset-library-note")
	status.setAttribute("role", "status")
	const content = element("div", "preset-browser-content")
	const nav = element("nav")
	nav.setAttribute("aria-label", "Preset sections")
	const preview = element("div", "preset-preview")
	content.append(nav, preview)
	scroll.append(toolbar, saveForm, status, content)
	const footer = element("footer", "preset-apply-bar")
	const applyText = element("p")
	const apply = button(
		"",
		() => {
			const { preset, setup } = selected()
			void perform(() =>
				setup
					? onChooseSetup
						? onChooseSetup(setup)
						: manager
							? applySetup(manager, setup)
							: undefined
					: preset
						? onApply(preset)
						: undefined
			)
		},
		"preset-apply-button primary"
	)
	footer.append(applyText, apply)
	surface.append(header, scroll, footer)
	if (dialog) {
		const trigger = host as HTMLButtonElement
		trigger.type = "button"
		trigger.className = `preset-browse${createChain ? " secondary-action" : ""}`
		trigger.textContent = createChain ? "New" : "Apply a preset…"
		trigger.onclick = () => {
			dialog.showModal()
			apply.focus({ preventScroll: true })
		}
		trigger.hidden = hideTrigger
		if (createChain) {
			trigger.setAttribute("aria-label", "Add new chain")
		}
		document.body.append(dialog)
	}
	function selected() {
		const presets = completePresets(library.presets)
		const setup = library.setups.find((item) => `setup:${item.id}` === selection)
		return {
			presets,
			setup,
			preset: setup
				? undefined
				: (presets.find((item) => `preset:${item.id}` === selection) ?? presets[0])
		}
	}
	function render() {
		const { presets, preset, setup } = selected()
		const categories = [...new Set(presets.map((item) => item.category))]
		const values = [
			...new Set(categories.map((value) => value.replace(/^Activities · /, ""))),
			...((!createChain || startup) && library.setups.length ? ["Setups"] : [])
		]
		if (
			JSON.stringify([...category.options].slice(1).map((option) => option.value)) !==
			JSON.stringify(values)
		) {
			const previous = category.value
			category.replaceChildren(
				option("All preset types", ""),
				...values.map((value) => option(value, value))
			)
			category.value = previous
		}
		const words = search.value.trim().toLowerCase().split(/\s+/)
		const matches = (item: {
			name: string
			description: string
			category?: string
			useCase?: string
		}) =>
			words.every((word) =>
				`${item.name} ${item.description} ${item.category ?? ""} ${item.useCase ?? ""}`
					.toLowerCase()
					.includes(word)
			)
		const filtered = presets.filter(
			(item) =>
				matches(item) &&
				(!category.value ||
					item.category.replace(/^Activities · /, "") === category.value) &&
				(!genre.value || presetContext(item)?.id === genre.value)
		)
		const setups =
			(createChain && !startup) ||
			genre.value ||
			(category.value && category.value !== "Setups")
				? []
				: library.setups.filter(matches)
		nav.replaceChildren()
		const choose = (id: string) => {
			selection = id
			editor = null
			message = ""
			render()
			if (window.matchMedia("(max-width: 640px)").matches) {
				preview.scrollIntoView?.({ block: "start", behavior: "smooth" })
			}
		}
		const card = (item: TransformerPreset, id: string, active: boolean) => {
			const node = button("", () => choose(id))
			node.disabled = busy
			node.setAttribute("aria-pressed", String(active))
			const label = element("span", "", item.name)
			if (id.startsWith("preset:")) {
				label.append(element("small", "preset-list-description", item.description))
			}
			node.append(createPresetArtwork({ preset: item, compact: true }), label)
			return node
		}
		for (const name of categories) {
			const items = filtered.filter((item) => item.category === name)
			if (!items.length) {
				continue
			}
			const section = element("section")
			section.append(element("h3", "", name))
			for (const item of items) {
				section.append(card(item, `preset:${item.id}`, preset?.id === item.id))
			}
			nav.append(section)
		}
		if (setups.length) {
			const section = element("section")
			section.append(element("h3", "", "Setups · multiple chains"))
			for (const item of setups) {
				section.append(
					card(
						{
							...item,
							category: "Setups",
							useCase: "",
							steps: item.chains.flatMap((chain) => chain.steps)
						},
						`setup:${item.id}`,
						setup?.id === item.id
					)
				)
			}
			nav.append(section)
		}
		if (!filtered.length && !setups.length) {
			nav.append(
				element(
					"p",
					"preset-no-results",
					"No matching presets. Try a different search or filter."
				)
			)
		}
		preview.replaceChildren()
		if (editor) {
			const editing = editor
			const form = element("form", "preset-editor")
			const label = element(
				"label",
				"",
				`Edit ${editing.kind === "presets" ? "preset" : "setup"} JSON`
			)
			const text = element("textarea")
			text.required = true
			text.rows = 20
			text.spellcheck = false
			text.value = editing.json
			text.oninput = () => {
				editing.json = text.value
			}
			label.append(text)
			const save = element("button", "", "Save changes")
			save.type = "submit"
			form.append(
				label,
				element(
					"p",
					"",
					"Change the name, description, category, use case or transformer settings. IDs remain stable when editing."
				),
				save,
				button("Cancel edit", () => {
					editor = null
					render()
				})
			)
			form.onsubmit = (event) => {
				event.preventDefault()
				run(() => {
					const item = { ...JSON.parse(editing.json), id: editing.id }
					if (editing.kind === "presets") {
						updatePreset(item)
					} else {
						const latest = readLibrary()
						latest.setups = latest.setups.map((setup) =>
							setup.id === editing.id ? item : setup
						)
						writeLibrary(latest)
					}
					selection = `${editing.kind === "presets" ? "preset" : "setup"}:${item.id}`
					editor = null
					undo = null
					message = "Changes saved in this browser. Save to file for a portable copy."
				})
			}
			preview.append(form)
		} else {
			if (preset) {
				preview.append(createPresetDetails(preset))
			}
			if (setup) {
				const article = element("article", "preset-details")
				article.append(
					createPresetArtwork({
						preset: { ...setup, steps: setup.chains.flatMap((chain) => chain.steps) }
					}),
					element("span", "preset-category", "Workspace setup"),
					element("h3", "", setup.name),
					element(
						"p",
						"",
						setup.description ||
							"A snapshot of chains, device settings and shared routing."
					),
					element("h4", "", `${setup.chains.length} chains`)
				)
				const list = element("ul")
				for (const chain of setup.chains) {
					list.append(
						element(
							"li",
							"",
							`${chain.options.name || chain.id} · ${chain.steps.length} transformers`
						)
					)
				}
				article.append(
					list,
					element(
						"p",
						"",
						"Loading replaces all current chains and routing. Save your current setup first if you want to keep it."
					)
				)
				preview.append(article)
			}
			if (!preset && !setup) {
				preview.append(
					element(
						"p",
						"",
						"Your library is empty. Create a preset or import a JSON file to get started."
					)
				)
			}
			const item = setup ?? preset
			if (item && !preset?.id.startsWith("activity:")) {
				const kind = setup ? "setups" : "presets"
				const details = element("details", "preset-item-tools")
				details.append(element("summary", "", `Manage this ${setup ? "setup" : "preset"}`))
				const actions = element("div", "preset-item-actions")
				actions.append(
					button("Save selected to file", () =>
						run(() => downloadLibrary(exportLibrary(preset?.id, setup?.id), item.name))
					),
					button("Edit JSON", () => {
						editor = { kind, id: item.id, json: JSON.stringify(item, null, 2) }
						render()
					})
				)
				if (preset) {
					actions.append(
						button("Duplicate preset", () => {
							editor = {
								kind: "presets",
								id: crypto.randomUUID(),
								json: JSON.stringify(
									{ ...preset, name: `${preset.name} copy` },
									null,
									2
								)
							}
							render()
						})
					)
				}
				actions.append(
					button(`Delete ${setup ? "setup" : "preset"}`, () =>
						run(() => {
							const before = exportLibrary(
								kind === "presets" ? item.id : undefined,
								kind === "setups" ? item.id : undefined
							)
							deleteLibraryItem(kind, item.id)
							undo = before
							selection = ""
							editor = null
							message = "Deleted from your library. You can undo this change."
						})
					)
				)
				for (const node of actions.querySelectorAll("button")) {
					node.disabled = busy || !!storageError
				}
				details.append(actions)
				preview.append(details)
			}
		}
		status.textContent = storageError || message
		status.hidden = !status.textContent
		undoButton.hidden = !undo
		for (const node of toolActions.querySelectorAll("button")) {
			node.disabled = busy || !!storageError
		}
		for (const node of toolbar.querySelectorAll<HTMLButtonElement>(":scope > button")) {
			node.disabled = busy
		}
		footer.hidden = !!editor || (!preset && !setup)
		applyText.textContent = startup
			? ((preset ?? setup)?.name ?? "")
			: createChain
				? "Creates a new chain with this preset."
				: setup
					? "Replaces every chain and its routing."
					: "Replaces transformers on this chain. Your input and instrument stay connected."
		apply.disabled = busy || !!storageError || (!!setup && !manager && !onChooseSetup)
		apply.textContent = busy
			? startup
				? "Starting…"
				: "Applying…"
			: startup
				? "Start Preset"
				: setup
					? `Replace workspace with ${setup.name}`
					: createChain
						? `Create ${preset?.name} chain`
						: `Apply ${preset?.name}`
	}
	const refresh = () => {
		try {
			library = readLibrary()
			storageError = ""
		} catch (error) {
			storageError = error instanceof Error ? error.message : "Preset storage is unavailable"
		}
		render()
	}
	window.addEventListener(EVENT_PRESET_LIBRARY_UPDATED, refresh)
	window.addEventListener(EVENT_STORAGE, refresh)
	refresh()
	return {
		element: host,
		destroy() {
			destroyed = true
			window.removeEventListener(EVENT_PRESET_LIBRARY_UPDATED, refresh)
			window.removeEventListener(EVENT_STORAGE, refresh)
			dialog?.remove()
			host.remove()
		}
	}
}