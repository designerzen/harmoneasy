import { INPUT_DEFINITIONS } from "audiobus/io/input-definitions"
import { OUTPUT_DEFINITIONS } from "audiobus/io/output-definitions"
import { TRANSFORMERS } from "audiobus/io/transformer-factory"
import { TRANSFORMER_DEFINITIONS } from "audiobus/io/transformer-definitions"
import { configurationSteps, stepsConfiguration } from "audiobus/io/preset-library"
import { parsePresetPage, type PresetPage } from "./preset-page"

export const PARTS_REDIRECT_KEY = "parts-route"
const KEYS = new Set([
	"v",
	"preset",
	"setup",
	"mode",
	"chain",
	"inputs",
	"outputs",
	"transformers",
	"inputs-mode",
	"outputs-mode",
	"transformers-mode",
	"midi",
	"playback",
	"track",
	"loop",
	"bpm",
	"swing",
	"divisions",
	"bars",
	"name",
	"description",
	"config"
])
const LISTS = new Set(["inputs", "outputs", "transformers"])
const PASSTHROUGH = new Set(["play", "room", "room-setup", "sync-bundle", PARTS_REDIRECT_KEY])
const MAX_DATA = 65536

function fail(message: string): never {
	throw new Error(`Invalid parts URL: ${message}`)
}

function rootUrl(location: string, base: string) {
	const root = new URL(base, location)
	root.pathname = `${root.pathname.replace(/\/$/, "")}/`
	return root
}

/** Recover static-host redirects without accepting an external or escaped app route. */
export function restorePartsUrl(location: string, base: string): URL {
	const url = new URL(location)
	if (!url.searchParams.has(PARTS_REDIRECT_KEY)) {
		return url
	}
	const path = url.searchParams.get(PARTS_REDIRECT_KEY)!
	const root = rootUrl(location, base)
	if (
		url.pathname !== root.pathname ||
		!/^(?:parts\/|(?:presets|preset|hardware|play)\/)/.test(path) ||
		/[?#\\]/.test(path)
	) {
		fail("invalid redirect route")
	}
	const target = new URL(root.pathname + path, root.origin)
	if (!target.pathname.startsWith(root.pathname) || !target.pathname.includes("/parts/")) {
		fail("invalid redirect route")
	}
	target.search = url.search
	target.searchParams.delete(PARTS_REDIRECT_KEY)
	target.hash = url.hash
	return target
}

export interface PartsLink {
	location: string
	baseLocation: string
	options: URLSearchParams
}

/** Path pairs < query parameters. Legacy fragments only provide midi/outputs defaults. */
export function parsePartsUrl(location: string, base: string): PartsLink | undefined {
	const url = restorePartsUrl(location, base)
	const root = rootUrl(location, base)
	if (!url.pathname.startsWith(root.pathname)) {
		return
	}
	const relative = url.pathname.slice(root.pathname.length).replace(/(^|\/)index\.html$/, "$1")
	if (relative === "parts") {
		fail("supported path version is /parts/v1/")
	}
	const marker = relative.indexOf("parts/")
	const hasParts = marker === 0 || (marker > 0 && relative[marker - 1] === "/")
	const explicit =
		hasParts ||
		[...url.searchParams.keys()].some(
			(key) => KEYS.has(key) && !["midi", "outputs"].includes(key)
		)
	if (!explicit) {
		return
	}
	const options = new URLSearchParams()
	const fragment = new URLSearchParams(url.hash.slice(1))
	for (const key of ["midi", "outputs"]) {
		for (const value of fragment.getAll(key)) {
			options.append(key, value)
		}
	}
	let source = relative
	if (hasParts) {
		source = relative.slice(0, marker).replace(/\/$/, "")
		if (source && !/^(presets|preset|hardware|play)\//.test(source)) {
			fail("parts must extend a preset or play route")
		}
		const parts = relative
			.slice(marker + "parts/".length)
			.replace(/\/$/, "")
			.split("/")
		if (parts.shift() !== "v1") {
			fail("supported path version is /parts/v1/")
		}
		if (parts.length % 2) {
			fail("path options require key/value pairs")
		}
		const path = new URLSearchParams()
		for (let index = 0; index < parts.length; index += 2) {
			const key = parts[index]
			if (!KEYS.has(key) || key === "v") {
				fail(`unknown path option ${key}`)
			}
			let value: string
			try {
				value = decodeURIComponent(parts[index + 1])
			} catch {
				fail(`invalid encoding for ${key}`)
			}
			path.append(key, value)
		}
		for (const key of new Set(path.keys())) {
			options.delete(key)
			for (const value of path.getAll(key)) {
				options.append(key, value)
			}
		}
	}
	// Base selectors form one group: a query can replace a path-selected base completely.
	if (
		url.searchParams.has("preset") ||
		url.searchParams.has("setup") ||
		url.searchParams.get("mode") === "replace"
	) {
		for (const key of ["preset", "setup", "mode"]) {
			options.delete(key)
		}
	}
	for (const key of new Set(url.searchParams.keys())) {
		if (!KEYS.has(key)) {
			if (!PASSTHROUGH.has(key) && !key.startsWith("utm_")) {
				fail(`unknown query option ${key}`)
			}
			continue
		}
		options.delete(key)
		for (const value of url.searchParams.getAll(key)) {
			options.append(key, value)
		}
	}
	if (options.has("v") && options.get("v") !== "1") {
		fail("supported query version is v=1")
	}
	for (const key of new Set(options.keys())) {
		if (!LISTS.has(key) && options.getAll(key).length !== 1) {
			fail(`duplicate option ${key}`)
		}
		if (!options.getAll(key).every((value) => value.trim().length > 0)) {
			fail(`empty option ${key}`)
		}
	}
	if (options.has("setup") && options.has("preset")) {
		fail("choose setup or preset, not both")
	}
	if (options.has("mode") && !["extend", "replace"].includes(options.get("mode")!)) {
		fail("mode must be extend or replace")
	}
	if (options.get("mode") === "replace" && (options.has("setup") || options.has("preset"))) {
		fail("mode=replace cannot also select setup or preset")
	}
	const baseLocation = new URL(source || "./", root)
	// Retain play redirect and room information, but do not reapply composition options.
	for (const key of PASSTHROUGH) {
		if (key !== PARTS_REDIRECT_KEY) {
			for (const value of url.searchParams.getAll(key)) {
				baseLocation.searchParams.append(key, value)
			}
		}
	}
	return { location: url.href, baseLocation: baseLocation.href, options }
}

function object(value: unknown, label: string): asserts value is Record<string, any> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		fail(`${label} must be an object`)
	}
}

function json(value: string, label: string): Record<string, any> {
	if (value.length > MAX_DATA) {
		fail(`${label} exceeds ${MAX_DATA} characters`)
	}
	let result: unknown
	try {
		result = JSON.parse(value)
	} catch {
		fail(`${label} must be valid JSON`)
	}
	const check = (item: any, depth = 0) => {
		if (typeof item === "number" && !Number.isFinite(item)) {
			fail(`${label} contains a non-finite number`)
		}
		if (depth > 32) {
			fail(`${label} is nested too deeply`)
		}
		if (item && typeof item === "object") {
			for (const [key, child] of Object.entries(item)) {
				if (["__proto__", "prototype", "constructor"].includes(key)) {
					fail(`forbidden property ${key}`)
				}
				check(child, depth + 1)
			}
		}
	}
	check(result)
	object(result, label)
	return result
}

function list(options: URLSearchParams, key: string): string[] {
	const values = options.getAll(key).flatMap((value) => value.split(","))
	if (values.length === 1 && values[0] === "none") {
		return []
	}
	if (values.some((value) => !value.trim())) {
		fail(`${key} contains an empty item`)
	}
	return key === "transformers"
		? values.map((value) => value.trim())
		: [...new Set(values.map((value) => value.trim()))]
}

function number(
	options: URLSearchParams,
	key: string,
	min: number,
	max: number,
	integer = false
): number | undefined {
	if (!options.has(key)) {
		return
	}
	const raw = options.get(key)!
	const value = Number(raw)
	if (
		!/^-?\d+(?:\.\d+)?$/.test(raw) ||
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(integer && !Number.isInteger(value))
	) {
		fail(`${key} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`)
	}
	return value
}

function blank(): PresetPage {
	return {
		format: "harmoneasy-preset",
		version: 1,
		name: "Custom setup",
		description: "",
		clock: { bpm: 110, swing: 0, divisions: 24, bars: 4 },
		midiControls: { enabled: true, bindings: [] },
		workspace: {
			version: 2,
			activeChainId: "url-chain",
			devices: [],
			chains: [
				{
					id: "url-chain",
					options: { name: "Custom setup", active: true },
					inputs: [],
					outputs: [],
					transformers: "[]",
					disabledInputs: [],
					disabledOutputs: []
				}
			]
		}
	}
}

/** "a", "a and b", "a, b and c" */
function sentenceList(items: string[]): string | undefined {
	return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]
}

function deviceNames(page: PresetPage, direction: "input" | "output"): string[] {
	const definitions = direction === "input" ? INPUT_DEFINITIONS : OUTPUT_DEFINITIONS
	return page.workspace.chains[0][`${direction}s`].map((id: string) => {
		const type = page.workspace.devices.find((device: any) => device.id === id)?.definition.type
		return definitions[type]?.name ?? type
	})
}

/** Name a setup built from scratch after what it plays, such as "Moog through Harmoniser". */
function describeName(page: PresetPage) {
	const effects = configurationSteps(page.workspace.chains[0].transformers)
		.filter((step) => !["MIDI-File-Player", "Ensemble", "identity"].includes(step.type))
		.map((step) => TRANSFORMER_DEFINITIONS[step.type]?.name ?? step.type)
	const outputs = deviceNames(page, "output")
	const name =
		sentenceList(outputs.length ? outputs : deviceNames(page, "input")) ?? "Custom setup"
	return effects.length ? `${name} through ${sentenceList(effects)}` : name
}

function fileName(url: string) {
	const name = url.split(/[?#]/)[0].split("/").pop() || url
	try {
		return decodeURIComponent(name)
	} catch {
		return name
	}
}

/** Say in plain words what a setup built from scratch does, for its landing page. */
function describeSetup(page: PresetPage) {
	const chain = page.workspace.chains[0]
	const sentences: string[] = []
	const inputs = deviceNames(page, "input")
	if (inputs.length) {
		sentences.push(`Play with the ${sentenceList(inputs)}.`)
	}
	for (const step of configurationSteps(chain.transformers)) {
		const file = step.config.midiFileUrl
			? fileName(String(step.config.midiFileUrl))
			: "the loaded MIDI file"
		if (step.type === "MIDI-File-Player" && step.config.playbackMode === "step") {
			sentences.push(
				`Every note you play steps ${file} forward by one note, so anyone can perform the song.`
			)
		} else if (step.type === "MIDI-File-Player" || step.type === "Ensemble") {
			sentences.push(`${file} plays along once the transport starts.`)
		} else if (step.type !== "identity") {
			const definition = TRANSFORMER_DEFINITIONS[step.type]
			sentences.push(
				definition
					? `${definition.name}: ${definition.description}`
					: `The ${step.type} step changes your notes.`
			)
		}
	}
	const outputs = deviceNames(page, "output")
	sentences.push(
		outputs.length
			? `You hear the result on the ${sentenceList(outputs)}.`
			: "Nothing is connected to hear it yet: add an output."
	)
	return sentences.join(" ")
}

function registry(type: string, direction: "input" | "output") {
	if (!Object.hasOwn(direction === "input" ? INPUT_DEFINITIONS : OUTPUT_DEFINITIONS, type)) {
		fail(`unknown ${direction} ${type}`)
	}
}

/** Validate shared data before handing it to any device constructors. */
function validate(page: PresetPage) {
	page = parsePresetPage(JSON.stringify(page))
	for (const device of page.workspace.devices) {
		if (device.definition.factory === "input" || device.definition.factory === "output") {
			registry(device.definition.type, device.definition.factory)
		}
		if (device.definition.options !== undefined) {
			object(device.definition.options, `options for ${device.id}`)
		}
	}
	return page
}

export async function loadPartsPage(
	link: PartsLink,
	base: string,
	loadBase: (location: string, base: string) => Promise<PresetPage | undefined>
): Promise<PresetPage> {
	const { options } = link
	const inputs = list(options, "inputs")
	const outputs = list(options, "outputs")
	const transformers = list(options, "transformers")
	for (const key of LISTS) {
		const mode = options.get(`${key}-mode`)
		if (mode && !["append", "replace"].includes(mode)) {
			fail(`${key}-mode must be append or replace`)
		}
		if (mode && !options.has(key)) {
			fail(`${key}-mode requires ${key}`)
		}
	}
	for (const type of inputs) {
		registry(type, "input")
	}
	for (const type of outputs) {
		registry(type, "output")
	}
	for (const type of transformers) {
		if (![...TRANSFORMERS, "identity"].includes(type)) {
			fail(`unknown transformer ${type}`)
		}
	}
	const root = rootUrl(link.location, base)
	let page: PresetPage | undefined
	if (options.has("setup")) {
		page = validate(json(options.get("setup")!, "setup") as PresetPage)
	} else if (options.get("mode") !== "replace") {
		let location = link.baseLocation
		if (options.has("preset")) {
			const path = options.get("preset")!
			if (!/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/.test(path)) {
				fail("preset must be a local preset route")
			}
			location = new URL(
				/^(presets|preset|hardware)\//.test(path) ? path : `presets/${path}`,
				root
			).href
		}
		page = await loadBase(location, base)
	}
	const fresh = !page
	page = structuredClone(page ?? blank())
	const chains = page.workspace.chains.filter(
		(chain: any) => !options.has("chain") || chain.id === options.get("chain")
	)
	if (
		!chains.length &&
		(options.has("chain") ||
			["inputs", "outputs", "transformers", "midi", "playback", "track", "loop"].some((key) =>
				options.has(key)
			))
	) {
		fail("chain does not identify an existing chain")
	}
	for (const chain of chains) {
		for (const direction of ["inputs", "outputs"]) {
			if (options.get(`${direction}-mode`) === "replace") {
				chain[direction] = []
				chain[direction === "inputs" ? "disabledInputs" : "disabledOutputs"] = []
			}
		}
	}
	const connect = (type: string, direction: "input" | "output") => {
		let device = page!.workspace.devices.find(
			(entry: any) =>
				entry.direction === direction &&
				entry.definition.factory === direction &&
				entry.definition.type === type
		)
		if (!device) {
			let id = `url-${direction}-${type}`
			while (page!.workspace.devices.some((entry: any) => entry.id === id)) {
				id += "-added"
			}
			device = { id, direction, definition: { factory: direction, type } }
			page!.workspace.devices.push(device)
		}
		for (const chain of chains) {
			const key = `${direction}s`
			if (!chain[key].includes(device.id)) {
				chain[key].push(device.id)
			}
			const disabled = direction === "input" ? "disabledInputs" : "disabledOutputs"
			chain[disabled] = (chain[disabled] ?? []).filter((id: string) => id !== device.id)
		}
	}
	for (const type of fresh && !options.has("inputs")
		? ["keyboard", "onscreen-keyboard"]
		: inputs) {
		connect(type, "input")
	}
	for (const type of fresh && !options.has("outputs") ? ["moog"] : outputs) {
		connect(type, "output")
	}
	for (const chain of chains) {
		const steps =
			options.get("transformers-mode") === "replace"
				? []
				: configurationSteps(chain.transformers)
		steps.push(...transformers.map((type) => ({ type, config: {}, summary: "" })))
		if (
			fresh &&
			options.has("midi") &&
			!steps.some((step) => ["MIDI-File-Player", "Ensemble"].includes(step.type))
		) {
			steps.unshift({
				type: "MIDI-File-Player",
				config: { playbackMode: "step", loop: true },
				summary: ""
			})
		}
		chain.transformers = stepsConfiguration(steps)
	}
	// Targeted settings are applied before shorthand overrides, making precedence explicit.
	if (options.has("config")) {
		const config = json(options.get("config")!, "config")
		for (const key of Object.keys(config)) {
			if (!["devices", "chains", "steps"].includes(key)) {
				fail(`unknown config section ${key}`)
			}
		}
		for (const key of ["devices", "chains", "steps"]) {
			if (key in config) {
				object(config[key], `config.${key}`)
			}
		}
		for (const [id, settings] of Object.entries(config.devices ?? {})) {
			object(settings, `config.devices.${id}`)
			const device = page.workspace.devices.find((entry: any) => entry.id === id)
			if (!device) {
				fail(`unknown device ${id}`)
			}
			device.definition.options = { ...device.definition.options, ...settings }
		}
		for (const [id, settings] of Object.entries(config.chains ?? {})) {
			object(settings, `config.chains.${id}`)
			const chain = page.workspace.chains.find((entry: any) => entry.id === id)
			if (!chain) {
				fail(`unknown chain ${id}`)
			}
			chain.options = { ...chain.options, ...settings }
		}
		for (const [id, settings] of Object.entries(config.steps ?? {})) {
			object(settings, `config.steps.${id}`)
			const chain = page.workspace.chains.find((entry: any) => entry.id === id)
			if (!chain) {
				fail(`unknown chain ${id}`)
			}
			const steps = configurationSteps(chain.transformers)
			for (const [index, value] of Object.entries(settings)) {
				object(value, `config.steps.${id}.${index}`)
				if (!/^(0|[1-9]\d*)$/.test(index) || !steps[Number(index)]) {
					fail(`unknown step ${id}.${index}`)
				}
				if ("type" in value) {
					fail("config cannot change a transformer's type")
				}
				steps[Number(index)].config = { ...steps[Number(index)].config, ...value }
			}
			chain.transformers = stepsConfiguration(steps)
		}
	}
	let midi: string | undefined
	if (options.has("midi")) {
		const url = new URL(options.get("midi")!, root)
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
			fail("midi must be an HTTP(S) file URL without credentials")
		}
		midi = url.href
	}
	const track = number(options, "track", -1, 65535, true)
	const playback = options.get("playback")
	if (playback && !["step", "file"].includes(playback)) {
		fail("playback must be step or file")
	}
	const loop = options.get("loop")
	if (loop && !["true", "false"].includes(loop)) {
		fail("loop must be true or false")
	}
	let matched = 0
	for (const chain of chains) {
		const steps = configurationSteps(chain.transformers)
		for (const step of steps) {
			if (!["MIDI-File-Player", "Ensemble"].includes(step.type)) {
				continue
			}
			matched++
			if (midi) {
				Object.assign(
					step.config,
					{ midiFileUrl: midi, midiFileName: "" },
					step.type === "MIDI-File-Player" ? { searchQuery: "", trackIndex: -1 } : {}
				)
			}
			if (loop) {
				step.config.loop = loop === "true"
			}
			if (step.type === "MIDI-File-Player") {
				if (track !== undefined) {
					step.config.trackIndex = track
				}
				if (playback) {
					step.config.playbackMode = playback
				}
			} else if (track !== undefined || playback) {
				fail("track/playback require a MIDI File Player, not Ensemble")
			}
		}
		chain.transformers = stepsConfiguration(steps)
	}
	if (!matched && ["midi", "track", "playback", "loop"].some((key) => options.has(key))) {
		fail("MIDI options require a MIDI File Player or Ensemble in the selected chains")
	}
	for (const [key, min, max, integer] of [
		["bpm", 10, 303, false],
		["swing", 0, 1, false],
		["divisions", 1, 960, true],
		["bars", 1, 32, true]
	] as const) {
		const value = number(options, key, min, max, integer)
		if (value !== undefined) {
			page.clock[key] = value
		}
	}
	if (options.has("name")) {
		page.name = options.get("name")!
	} else if (fresh && midi) {
		page.name = `${new URL(midi).pathname.split("/").pop()} — Custom MIDI setup`
	} else if (fresh) {
		page.name = describeName(page)
	}
	if (options.has("description")) {
		page.description = options.get("description")!
	} else if (fresh) {
		page.description = describeSetup(page)
	}
	delete page.catalogue
	if (midi) {
		delete (page as PresetPage & { source?: unknown }).source
	}
	return validate(page)
}

/** Build shareable links without manual escaping of file URLs or JSON. */
export function createPartsUrl(
	location: string,
	base: string,
	options: Record<string, string | string[]>,
	source = ""
): string {
	const root = rootUrl(location, base)
	if (source && !/^(?:presets|preset|hardware|play)\/[a-z0-9][a-z0-9_/-]*$/.test(source)) {
		fail("source must be a local preset or play route")
	}
	const url = new URL(`${source ? source.replace(/\/$/, "") + "/" : ""}parts/v1/`, root)
	for (const [key, values] of Object.entries(options)) {
		if (!KEYS.has(key) || key === "v") {
			fail(`unknown option ${key}`)
		}
		for (const value of Array.isArray(values) ? values : [values]) {
			url.searchParams.append(key, value)
		}
	}
	parsePartsUrl(url.href, base)
	return url.href
}