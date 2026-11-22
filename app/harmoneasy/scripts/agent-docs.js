import { readFile } from "node:fs/promises"
import { dirname, resolve, relative } from "node:path"
import { createServer } from "vite"
import ts from "typescript"

const repository = resolve(import.meta.dirname, "../../..")
const audioBus = "packages/audiobus/"
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
	"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char])
const json = (value) => JSON.stringify(value, null, 2)

/** Resolve switch-based factories without creating inputs, audio engines or requesting permissions. */
async function factorySources(file, constants) {
	const path = resolve(repository, file)
	const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true)
	const imports = new Map()
	for (const statement of source.statements) {
		if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings &&
			ts.isNamedImports(statement.importClause.namedBindings)) {
			for (const name of statement.importClause.namedBindings.elements) {
				imports.set(name.name.text, statement.moduleSpecifier.text)
			}
		}
	}
	const result = new Map()
	const visit = (node) => {
		if (ts.isCaseBlock(node)) {
			let pending = []
			for (const clause of node.clauses) {
				if (!ts.isCaseClause(clause)) continue
				const key = clause.expression.getText(source).split(".").at(-1)
				pending.push(constants[key])
				let module
				const find = (child) => {
					if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword &&
						ts.isStringLiteral(child.arguments[0])) module = child.arguments[0].text
					if (ts.isNewExpression(child)) module = imports.get(child.expression.getText(source)) ?? module
					ts.forEachChild(child, find)
				}
				clause.statements.forEach(find)
				if (module) {
					for (const id of pending.filter(Boolean)) result.set(id, resolve(dirname(path), module))
					pending = []
				}
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(source)
	return result
}

export async function agentDocumentationAssets(base = "/") {
	// Use Vite's TS/module resolution in a headless loader, independent of the app's build.
	const loader = await createServer({
		root: resolve(repository, "app/harmoneasy"), configFile: false,
		appType: "custom", server: { middlewareMode: true, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] },
		plugins: [{
			name: "agent-docs-commonjs-midi",
			transform(code, id) {
				if (id.endsWith("/midi-song.ts")) {
					return code.replace('import { Midi } from "@tonejs/midi"',
						'import midiPackage from "@tonejs/midi"; const { Midi } = midiPackage')
				}
			}
		}]
	})
	const load = (file) => loader.ssrLoadModule(resolve(repository, file).replaceAll("\\", "/"))
	try {
		const profiles = await load(audioBus + "hardware/midi-devices/device-profiles.ts")
		const profileSchema = await load(audioBus + "hardware/midi-devices/device-profile-schema.ts")
		const profileIndex = JSON.parse(await readFile(resolve(repository, "packages/midi-devices/devices/index.json"), "utf8"))
		for (const entry of profileIndex) {
			const file = `packages/midi-devices/devices/${entry.path}/${entry.id}.json`
			profiles.MIDI_DEVICE_PROFILES[entry.id] = profileSchema.parseMidiDeviceProfile(entry.id,
				JSON.parse(await readFile(resolve(repository, file), "utf8")), (asset) => `${base}midi-devices/${entry.path}/${asset}`)
		}
		// Import registries after populating profiles, then apply the app's engine registrations.
		const host = await load("app/harmoneasy/source/audiobus-host.ts")
		host.configureAudiobus()
		const inputs = await load(audioBus + "io/input-definitions.ts")
		const outputs = await load(audioBus + "io/output-definitions.ts")
		const transformers = await load(audioBus + "io/transformer-definitions.ts")
		const factory = await load(audioBus + "io/transformer-factory.ts")
		const inputFactory = await load(audioBus + "io/input-factory.ts")
		const outputFactory = await load(audioBus + "io/output-factory.ts")
		const inputTypes = await load(audioBus + "io/inputs/input-types.ts")
		const outputTypes = await load(audioBus + "io/outputs/output-types.ts")
		const effects = await load(audioBus + "effects/effect-registry.ts")
		const instruments = await load(audioBus + "instruments/instrument-types.ts")
		const guidance = await load("app/harmoneasy/source/components/graph/device-card.ts")
		const uiInputs = await load(audioBus + "ui/input-components.ts")
		const aiInputs = await load(audioBus + "io/inputs/ai-model-catalogue.ts")
		const sourceMaps = {
			input: await factorySources(audioBus + "io/input-factory.ts", inputTypes),
			output: await factorySources(audioBus + "io/output-factory.ts", outputTypes),
			transformer: await factorySources(audioBus + "io/transformer-factory.ts", factory.TRANSFORMER_TYPE)
		}
		const assets = new Map()
		const entries = []
		const sourceUrl = async (path) => {
			if (!/\.(ts|json)$/.test(path)) path += ".ts"
			const name = `docs/ai/source/${relative(repository, path).replaceAll("\\", "/")}.txt`
			if (!assets.has(name)) assets.set(name, await readFile(path, "utf8"))
			return base + name
		}
		const add = async (kind, definition, extra = {}) => {
			const { id, name, description, category, subtype } = definition
			const factories = kind === "input" ? inputFactory.INPUT_FACTORIES : outputFactory.OUTPUT_FACTORIES
			const provider = factories.find((item) => item.id === id)
			const guide = (kind === "input" ? guidance.INPUT_GUIDANCE : guidance.OUTPUT_GUIDANCE)[id]
			let path = sourceMaps[kind]?.get(id)
			if (kind === "input" && aiInputs.AI_MODELS[id]) path = resolve(repository, audioBus + "io/inputs/input-ai-music.ts")
			if (kind === "input" && uiInputs.UI_INPUT_COMPONENTS[id]) path = resolve(repository, audioBus + "io/inputs/input-web-component.ts")
			if (kind === "input" && profiles.MIDI_DEVICE_PROFILES[id]) path = resolve(repository, audioBus + "io/inputs/input-profiled-midi-device.ts")
			if (kind === "output" && id.startsWith("wam2:")) path = resolve(repository, audioBus + "io/outputs/output-wam2.ts")
			if (kind === "output" && id.startsWith("webclap:")) path = resolve(repository, audioBus + "instruments/clap/clap-instrument.ts")
			if (kind === "output" && ["pink-trombone", "voice-workshop"].includes(id)) path = resolve(repository, `packages/audiobus-output-${id}/output-${id}.ts`)
			if (kind === "effect" || (kind === "output" && definition.subtype === "effect")) {
				path = resolve(repository, audioBus + `effects/effect-${extra.effectId ?? id.replace(/^effect:/, "")}.ts`)
			}
			if (kind === "instrument") {
				const module = definition.loader?.toString().match(/\(["'](\.\/[^"']+)["']\)/)?.[1]
				path = module ? resolve(repository, audioBus + "instruments", module) :
					resolve(repository, "packages/audiobus-output-opendaw-vaporisateur/opendaw-vaporisateur.ts")
			}
			path ??= resolve(repository, audioBus + `io/${kind}-definitions.ts`)
			const source = await sourceUrl(path)
			const text = assets.get(source.slice(base.length))
			const optionKeys = [...new Set([...text.matchAll(/\b(?:options|config)\??\.([A-Za-z][\w]*)/g)].map((match) => match[1]))].sort()
			const entry = {
				kind, id, name, description, category, subtype,
				factory: kind === "effect" ? "output" : kind,
				registered: kind === "transformer" ? factory.TRANSFORMERS.includes(id) :
					kind === "instrument" || kind === "effect" || Boolean(provider),
				requires: provider?.requires ?? definition.requires ?? [],
				guidance: guide, optionKeys, configurationSource: source,
				url: `${base}docs/ai/#${kind}-${encodeURIComponent(id)}`, ...extra
			}
			if (profiles.MIDI_DEVICE_PROFILES[id] && kind === "input") {
				const profile = profileIndex.find((item) => item.id === id)
				entry.profile = await sourceUrl(resolve(repository, `packages/midi-devices/devices/${profile.path}/${id}.json`))
			}
			entries.push(entry)
		}
		for (const definition of Object.values(inputs.INPUT_DEFINITIONS)) await add("input", definition)
		for (const definition of Object.values(outputs.OUTPUT_DEFINITIONS)) await add("output", definition)
		for (const definition of instruments.INSTRUMENTS.values()) await add("instrument", definition, { defaultOptions: definition.defaultOptions })
		for (const definition of Object.values(transformers.TRANSFORMER_DEFINITIONS)) {
			let extra = {}
			if (factory.TRANSFORMERS.includes(definition.id)) {
				const instance = factory.tranformerFactory(definition.id, { midiControlId: "agent-docs" })
				try {
					const { midiControlId, available, ...defaults } = JSON.parse(instance.exportConfig())
					extra = { defaults, controls: instance.fields }
				} finally { instance.destroy() }
			}
			await add("transformer", definition, extra)
		}
		for (const effect of effects.EFFECT_REGISTRY) {
			const { create, ...definition } = effect
			await add("effect", definition, { outputId: outputTypes.effectOutputId(effect.id), parameters: effect.parameters, mix: effect.mix })
		}
		const catalog = { version: 1, entries }
		assets.set("docs/ai/catalog.json", json(catalog))
		const api = await readFile(resolve(repository, "docs/preset-url-api.md"), "utf8")
		assets.set("docs/ai/preset-url-api.txt", api)
		const guide = await readFile(resolve(repository, "docs/ai-agents.html"), "utf8")
		const reference = entries.map((entry) => `<article id="${escape(`${entry.kind}-${encodeURIComponent(entry.id)}`)}"><h3>${escape(entry.name)} <code>${escape(entry.id)}</code></h3><p>${escape(entry.description)}</p><pre>${escape(json(entry))}</pre><p><a href="${escape(entry.configurationSource)}">Configuration implementation (plain text)</a></p></article>`).join("\n")
		assets.set("docs/ai/index.html", guide.replaceAll("{{BASE}}", base).replace("{{CATALOG}}", reference))
		const llms = `# Harmoneasy AI agent documentation\n\nCreate a custom music preset from an intention. All URLs below are relative to this deployment root.\n\n- [Start here](${base}docs/ai/): workflow, routing, shared-room MIDI ensemble recipe and complete component reference.\n- [Component catalog](${base}docs/ai/catalog.json): every input, output, instrument, effect and transformer; exact IDs, requirements, controls, defaults and configuration sources.\n- [Preset URL API](${base}docs/ai/preset-url-api.txt): URL parameters, full setup schema and validation.\n- [Published presets](${base}presets/index.json): routes; fetch a route's preset.json for reusable workspace data.\n- [Full plain-text reference](${base}llms-full.txt).\n\nRead configurationSource for component-specific options. Runtime resources are supplied by the app. The user must start audio and grant permissions. A room name alone does not establish a connection.\n`
		assets.set("llms.txt", llms)
		assets.set("llms-full.txt", `${llms}\n${guide.replace("{{CATALOG}}", "").replaceAll("{{BASE}}", base).replace(/<[^>]+>/g, "")}\n\n${api}\n\n# Complete component catalog\n${json(catalog)}`)
		return assets
	} finally {
		await loader.close()
	}
}

/** Publish the same crawlable docs in development and static builds, including subpath hosts. */
export function agentDocsPlugin() {
	let base
	let pending
	const assets = () => pending ??= agentDocumentationAssets(base).catch((error) => { pending = undefined; throw error })
	return {
		name: "harmoneasy-agent-docs",
		configResolved(config) { base = config.base },
		configureServer(server) {
			server.watcher.on("change", () => { pending = undefined })
			server.middlewares.use(async (request, response, next) => {
				const pathname = new URL(request.url, "http://localhost").pathname
				if (!pathname.startsWith(base)) return next()
				let name = pathname.slice(base.length)
				if (!["llms.txt", "llms-full.txt", "docs/ai"].includes(name) && !name.startsWith("docs/ai/")) return next()
				if (["docs/ai", "docs/ai/"].includes(name)) name = "docs/ai/index.html"
				try {
					const content = (await assets()).get(name)
					if (content === undefined) { response.statusCode = 404; return response.end("Documentation not found") }
					response.setHeader("Content-Type", name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8")
					response.end(content)
				} catch (error) { next(error) }
			})
		},
		async generateBundle() {
			for (const [fileName, source] of await assets()) this.emitFile({ type: "asset", fileName, source })
		}
	}
}
