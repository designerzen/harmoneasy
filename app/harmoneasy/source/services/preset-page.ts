import { compressToBase64 } from "lz-string"
import { validSurfaces } from "control-surface/model"
import { configurationSteps, parsePresetLibrary } from "audiobus/io/preset-library"
import { parseMusicTools } from "audiobus/io/music-tools"
import { isRoomSetup } from "./room-url"
import { validBinding, type MidiBinding } from "./midi-controls"
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
	const url = presetPageUrl(location, base)
	if (!url) {
		return
	}
	const response = await fetcher(url.href)
	if (!response.ok) {
		throw new Error(`Could not load preset (${response.status})`)
	}
	return parsePresetPage(await response.text())
}