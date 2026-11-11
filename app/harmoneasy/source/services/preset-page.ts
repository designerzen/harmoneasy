import { compressToBase64 } from "lz-string"
import { validSurfaces } from "control-surface/model"
import { configurationSteps, parsePresetLibrary } from "audiobus/io/preset-library"
import { parseMusicTools } from "audiobus/io/music-tools"
import { isRoomSetup } from "./room-url"
import { loadPlayPage, playRoute } from "./play-page"
import { validBinding, type MidiBinding } from "./midi-controls"
import { OUTPUT_DEFINITIONS } from "audiobus/io/output-definitions"
import type { PresetSetup } from "audiobus/io/preset-library"

export interface PresetPage {
	format: "harmoneasy-preset"
	version: 1
	name: string
	description: string
	workspace: Record<string, any>
	clock: { bpm: number; swing: number; divisions: number; bars: number }
	midiControls: { enabled: boolean; bindings: MidiBinding[] }
	catalogue?: {
		id?: string
		category?: string
		useCase?: string
		kind?: "chain" | "workspace"
		order?: number
		stepSummaries?: string[]
		tags?: string[]
		options?: Record<string, any>
	}
}

export function presetWorkspace(preset: PresetPage): string {
	return "workspace:" + compressToBase64(JSON.stringify(preset.workspace))
}

export function presetPageSetup(page: PresetPage, id: string): PresetSetup {
	const workspace = structuredClone(page.workspace)
	return {
		...workspace,
		id,
		name: page.name,
		description: page.description,
		clock: structuredClone(page.clock),
		chains: workspace.chains.map(
			({ transformers, ...chain }: Record<string, any>, chainIndex: number) => ({
				...chain,
				steps: configurationSteps(transformers).map((step, index) => ({
					...step,
					summary:
						(chainIndex === 0 ? page.catalogue?.stepSummaries?.[index] : undefined) ??
						step.summary
				}))
			})
		)
	} as PresetSetup
}

export function parsePresetPage(json: string): PresetPage {
	const data = JSON.parse(json)
	if (
		data?.format !== "harmoneasy-preset" ||
		data.version !== 1 ||
		typeof data.name !== "string" ||
		!data.name.trim() ||
		typeof data.description !== "string" ||
		data.workspace?.version !== 2 ||
		!Array.isArray(data.workspace.chains) ||
		!Array.isArray(data.workspace.devices)
	) {
		throw new Error("Invalid Harmoneasy preset")
	}
	// Reuse setup validation while retaining the complete workspace, including
	// music tools, disabled endpoints, graph positions and control surfaces.
	if (data.catalogue !== undefined) {
		const catalogue = data.catalogue
		if (
			!catalogue ||
			typeof catalogue !== "object" ||
			Array.isArray(catalogue) ||
			["id", "category", "useCase"].some(
				(key) =>
					catalogue[key] !== undefined &&
					(typeof catalogue[key] !== "string" || !catalogue[key].trim())
			) ||
			(catalogue.kind !== undefined && !["chain", "workspace"].includes(catalogue.kind)) ||
			(catalogue.tags !== undefined &&
				(!Array.isArray(catalogue.tags) ||
					catalogue.tags.length > 32 ||
					!catalogue.tags.every(
						(tag: unknown) =>
							typeof tag === "string" && tag.trim().length > 0 && tag.length <= 64
					))) ||
			(catalogue.order !== undefined &&
				(!Number.isInteger(catalogue.order) || catalogue.order < 0)) ||
			(catalogue.stepSummaries !== undefined &&
				(!Array.isArray(catalogue.stepSummaries) ||
					!catalogue.stepSummaries.every(
						(summary: unknown) => typeof summary === "string"
					)))
		) {
			throw new Error("Invalid preset catalogue metadata")
		}
	}
	parsePresetLibrary(
		JSON.stringify({
			format: "harmoneasy-preset-library",
			version: 1,
			presets:
				data.catalogue?.options === undefined
					? []
					: [
							{
								id: "catalogue",
								name: data.name,
								description: "",
								category: "Published",
								useCase: "",
								steps: [],
								options: data.catalogue.options
							}
						],
			setups: [
				{
					id: "page",
					name: data.name,
					description: data.description,
					...data.workspace,
					chains: data.workspace.chains.map(
						({ transformers, ...chain }: Record<string, any>) => ({
							...chain,
							steps: configurationSteps(transformers)
						})
					)
				}
			]
		})
	)
	parseMusicTools(data.workspace.musicTools)
	for (const chain of data.workspace.chains) {
		if (
			chain.options.controlSurfaces !== undefined &&
			!validSurfaces(chain.options.controlSurfaces)
		) {
			throw new Error("Invalid preset control surfaces")
		}
		for (const direction of ["Inputs", "Outputs"]) {
			const disabled = chain[`disabled${direction}`]
			if (
				disabled !== undefined &&
				(!Array.isArray(disabled) ||
					disabled.some((id: unknown) => !chain[direction.toLowerCase()].includes(id)))
			) {
				throw new Error("Invalid preset disabled endpoints")
			}
		}
	}
	if (!isRoomSetup({ ...data.clock, version: 1, workspace: "workspace:" })) {
		throw new Error("Invalid preset clock")
	}
	if (
		typeof data.midiControls?.enabled !== "boolean" ||
		!Array.isArray(data.midiControls.bindings) ||
		!data.midiControls.bindings.every(validBinding)
	) {
		throw new Error("Invalid preset MIDI mappings")
	}
	return data
}

/** Only local folder routes can choose preset files; query parameters cannot supply URLs. */
export function presetPageUrl(location: string, base: string): URL | undefined {
	const url = new URL(location)
	const root = new URL(base, url)
	const basePath = `${root.pathname.replace(/\/$/, "")}/`
	const relative = url.pathname.slice(basePath.length)
	if (!url.pathname.startsWith(basePath) || !/^(preset|presets|hardware)\//.test(relative)) {
		return
	}
	const path = relative.replace(/\/(?:index\.html)?$/, "")
	if (!/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/.test(path)) {
		throw new Error("Invalid preset path")
	}
	return new URL(`${basePath}${path}/preset.json`, url.origin)
}

export async function loadPresetPage(
	location: string,
	base: string,
	fetcher = fetch
): Promise<PresetPage | undefined> {
	const link = new URL(location)
	// Fragments take precedence so shared links can be customised without changing their route.
	const options = new URLSearchParams(link.search)
	const fragment = new URLSearchParams(link.hash.slice(1))
	for (const key of ["midi", "outputs"]) {
		if (fragment.has(key)) {
			options.delete(key)
			for (const value of fragment.getAll(key)) {
				options.append(key, value)
			}
		}
	}
	const midi = options.get("midi")
	let midiUrl: URL | undefined
	if (midi !== null) {
		if (!midi.trim()) {
			throw new Error("The midi option needs a MIDI file URL.")
		}
		midiUrl = new URL(midi, new URL(base, link))
		if (!["http:", "https:"].includes(midiUrl.protocol)) {
			throw new Error("MIDI links must use HTTP or HTTPS.")
		}
	}
	const outputs = [
		...new Set(
			options
				.getAll("outputs")
				.flatMap((value) => value.split(","))
				.map((value) => value.trim())
				.filter(Boolean)
		)
	]
	for (const type of outputs) {
		if (!Object.hasOwn(OUTPUT_DEFINITIONS, type)) {
			throw new Error(`Unknown output: ${type}`)
		}
	}
	const play = playRoute(location, base)
	const url = presetPageUrl(location, base)
	const root = new URL(base, link)
	const isRoot = link.pathname === root.pathname || link.pathname === `${root.pathname}index.html`
	if (!url && !play && !(isRoot && midiUrl)) {
		return
	}
	let page: PresetPage
	if (play && !midiUrl) {
		page = await loadPlayPage(play, base, link.origin, fetcher)
	} else {
		const response = await fetcher(
			(url ?? new URL("presets/songs/twinkle-twinkle-little-star/preset.json", root)).href
		)
		if (!response.ok) {
			throw new Error(`Could not load preset (${response.status})`)
		}
		page = parsePresetPage(await response.text())
	}
	if (midiUrl) {
		let players = 0
		for (const chain of page.workspace.chains) {
			chain.transformers = JSON.stringify(
				JSON.parse(chain.transformers).map((step: string) => {
					const config = JSON.parse(step)
					if (config.type !== "MIDI-File-Player") {
						return step
					}
					players++
					return JSON.stringify({
						...config,
						midiFileUrl: midiUrl.href,
						midiFileName: "",
						searchQuery: "",
						trackIndex: -1
					})
				})
			)
		}
		if (!players) {
			throw new Error("This preset has no MIDI File Player to load the midi option.")
		}
		page.name = `${decodeURIComponent(midiUrl.pathname.split("/").pop() || "MIDI file")} — One-key melody`
		page.description =
			"Press a playing key to play the next MIDI melody note. Release to end the note. Choose another file in the MIDI File Player."
		for (const chain of page.workspace.chains) {
			chain.options.name = page.name
		}
		delete (page as PresetPage & { source?: unknown }).source
	}
	for (const type of outputs) {
		let device = page.workspace.devices.find(
			(entry: any) =>
				entry.direction === "output" &&
				entry.definition.factory === "output" &&
				entry.definition.type === type
		)
		if (!device) {
			let id = `url-output-${type}`
			while (page.workspace.devices.some((entry: any) => entry.id === id)) {
				id += "-added"
			}
			device = { id, direction: "output", definition: { factory: "output", type } }
			page.workspace.devices.push(device)
		}
		for (const chain of page.workspace.chains) {
			if (!chain.outputs.includes(device.id)) {
				chain.outputs.push(device.id)
			}
			chain.disabledOutputs = (chain.disabledOutputs ?? []).filter(
				(id: string) => id !== device.id
			)
		}
	}
	if (midiUrl || outputs.length) {
		delete page.catalogue
	}
	return parsePresetPage(JSON.stringify(page))
}