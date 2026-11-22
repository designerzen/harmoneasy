import { describe, expect, it, vi } from "vitest"
import { runInNewContext } from "node:vm"
import { readFileSync } from "node:fs"
import { readPresetFiles } from "../scripts/preset-files.js"
import { roomFallbackHtml } from "../scripts/room-pages.js"
import { loadPresetPage, parsePresetPage } from "../source/services/preset-page"
import { createPartsUrl, parsePartsUrl, restorePartsUrl } from "../source/services/parts-url"
import { configurationSteps } from "audiobus/io/preset-library"
import { createRoomUrl } from "../source/services/room-url"

const origin = "https://example.test"
const base = "/harmoneasy/"
const pages = readPresetFiles("presets")
const fetcher = vi.fn(async (url: string) => {
	const route = new URL(url).pathname.slice(base.length).replace(/\/preset.json$/, "")
	const page = pages.get(route)
	return page ? Response.json(page) : new Response(null, { status: 404 })
})
const load = (path: string) => loadPresetPage(`${origin}${base}${path}`, base, fetcher)
const steps = (page: any, index = 0) =>
	configurationSteps(page.workspace.chains[index].transformers)

describe("versioned parts URLs", () => {
	it("composes Cosmo number keys and any MIDI file through the existing schema", async () => {
		for (const midi of [
			"midi/never-gonna-give-you-up.mid",
			"https://files.example/another.mid"
		]) {
			const page = await load(
				`parts/v1/inputs/cosmo-dots/outputs/moog,webmidi/midi/${encodeURIComponent(midi)}/playback/step/?config=${encodeURIComponent(JSON.stringify({ devices: { "url-input-cosmo-dots": { dotCount: 9 } } }))}`
			)
			expect(page!.workspace.chains[0].inputs).toEqual(["url-input-cosmo-dots"])
			expect(page!.workspace.chains[0].outputs).toEqual([
				"url-output-moog",
				"url-output-webmidi"
			])
			expect(
				page!.workspace.devices.find((device: any) => device.id === "url-input-cosmo-dots")
					.definition.options
			).toEqual({ dotCount: 9 })
			expect(steps(page)).toEqual([
				expect.objectContaining({
					type: "MIDI-File-Player",
					config: expect.objectContaining({
						playbackMode: "step",
						loop: true,
						midiFileUrl: new URL(midi, origin + base).href
					})
				})
			])
		}
	})
	it.each(["/", "/harmoneasy/", "/nested/app/"])(
		"supports deployment base %s, trailing slashes and index.html",
		async (deployment) => {
			for (const ending of ["", "/", "/index.html"]) {
				const page = await loadPresetPage(
					`${origin}${deployment}parts/v1/outputs/describe${ending}`,
					deployment,
					fetcher
				)
				expect(page!.workspace.chains[0].outputs).toEqual(["url-output-describe"])
			}
		}
	)
	it("builds a playable custom setup without fetching a template", async () => {
		fetcher.mockClear()
		const page = await load(
			"parts/v1/inputs/keyboard,onscreen-keyboard/outputs/moog,speech-synthesis/transformers/Transposer/?bpm=95&name=My+setup"
		)
		expect(fetcher).not.toHaveBeenCalled()
		expect(page!.name).toBe("My setup")
		expect(page!.clock.bpm).toBe(95)
		expect(page!.workspace.devices.map((device: any) => device.definition.type)).toEqual([
			"keyboard",
			"onscreen-keyboard",
			"moog",
			"speech-synthesis"
		])
		expect(steps(page)[0].type).toBe("Transposer")
	})

	it("names and describes a setup built from scratch by what it plays", async () => {
		const page = await load(
			"parts/v1/inputs/keyboard,onscreen-keyboard/outputs/moog,speech-synthesis/transformers/Harmoniser/"
		)
		expect(page!.name).toBe("Moog and Speech Synthesis through Harmoniser")
		expect(page!.description).toBe(
			"Play with the Keyboard and Onscreen Keyboard. Harmoniser: Snap incoming notes into a chosen key and scale, or filter out-of-scale notes. You hear the result on the Moog and Speech Synthesis."
		)
		const song = await load("parts/v1/?midi=midi/my%20song.mid&playback=step")
		expect(song!.description).toContain(
			"Every note you play steps my song.mid forward by one note"
		)
		const custom = await load("parts/v1/inputs/keyboard/?description=Just+play")
		expect(custom!.description).toBe("Just play")
	})

	it("extends every published preset through the same path grammar", async () => {
		for (const [route, source] of pages) {
			const page = await load(`${route}/parts/v1/outputs/speech-synthesis/`)
			expect(page!.workspace.chains.length, route).toBe(source.workspace.chains.length)
			for (let i = 0; i < source.workspace.chains.length; i++) {
				expect(steps(page, i), route).toEqual(steps(source, i))
				const speech = page!.workspace.devices.find(
					(device: any) => device.definition.type === "speech-synthesis"
				)
				expect(page!.workspace.chains[i].outputs, route).toContain(speech.id)
			}
			expect(() => parsePresetPage(JSON.stringify(page)), route).not.toThrow()
		}
	})

	it("gives query parameters precedence over paths and legacy fragments", async () => {
		const page = await load(
			"parts/v1/outputs/describe/bpm/80/?outputs=speech-synthesis&bpm=120#outputs=notation"
		)
		expect(page!.clock.bpm).toBe(120)
		expect(page!.workspace.chains[0].outputs).toEqual(["url-output-speech-synthesis"])
	})

	it("selects another preset from queries and can replace a preset entirely", async () => {
		const source = "presets/genres/electro/parts/v1/"
		const page = await load(`${source}?preset=songs/ode-to-joy`)
		expect(steps(page)[0].config.midiFileUrl).toBe("midi/ode-to-joy.mid")
		fetcher.mockClear()
		const replaced = await load(
			`${source}?mode=replace&inputs=keyboard&outputs=describe&transformers=Transposer`
		)
		expect(fetcher).not.toHaveBeenCalled()
		expect(replaced!.workspace.chains).toHaveLength(1)
		expect(replaced!.workspace.chains[0].outputs).toEqual(["url-output-describe"])
		expect(steps(replaced).map((step) => step.type)).toEqual(["Transposer"])
	})

	it("lets query base selectors replace the whole path-selected base", async () => {
		const path = "parts/v1/preset/songs%2Fode-to-joy/"
		const replaced = await load(`${path}?mode=replace&outputs=describe`)
		expect(steps(replaced)).toEqual([])
		const source = pages.get("presets/activities/describe-readout")!
		const supplied = await load(`${path}?setup=${encodeURIComponent(JSON.stringify(source))}`)
		expect(supplied!.workspace).toEqual(source.workspace)
		const selected = await load("parts/v1/mode/replace/?preset=songs%2Fode-to-joy")
		expect(steps(selected)[0].config.midiFileUrl).toBe("midi/ode-to-joy.mid")
	})

	it("loads arbitrary MIDI files at the root, in paths and in queries, with explicit playback options", async () => {
		const midi = "https://files.example/song.mid?download=1&version=2"
		for (const path of [
			`parts/v1/midi/${encodeURIComponent(midi)}/`,
			`?v=1&midi=${encodeURIComponent(midi)}`
		]) {
			const page = await load(
				`${path}${path.includes("?") ? "&" : "?"}outputs=speech-synthesis&track=3&loop=false&playback=file`
			)
			expect(steps(page)[0]).toMatchObject({
				type: "MIDI-File-Player",
				config: { midiFileUrl: midi, trackIndex: 3, loop: false, playbackMode: "file" }
			})
		}
	})

	it("scopes changes to a chain and supports replacing each section", async () => {
		const source = [...pages.values()].find((page) => page.workspace.chains.length > 1)!
		const link = createPartsUrl(origin, base, {
			setup: JSON.stringify(source),
			chain: source.workspace.chains[0].id,
			inputs: "keyboard",
			"inputs-mode": "replace",
			outputs: "speech-synthesis",
			"outputs-mode": "replace",
			transformers: "Transposer,Transposer",
			"transformers-mode": "replace"
		})
		const page = await loadPresetPage(link, base, fetcher)
		const keyboard = source.workspace.devices.find(
			(device: any) =>
				device.definition.factory === "input" && device.definition.type === "keyboard"
		)
		expect(page!.workspace.chains[0].inputs).toEqual([keyboard?.id ?? "url-input-keyboard"])
		expect(page!.workspace.chains[0].outputs).toEqual(["url-output-speech-synthesis"])
		expect(steps(page).map((step) => step.type)).toEqual(["Transposer", "Transposer"])
		expect(page!.workspace.chains[1]).toEqual(source.workspace.chains[1])
	})

	it("accepts complete multi-chain exports without changing shared routing or surfaces", async () => {
		const source = pages.get("hardware/arcana/strum")!
		const link = createPartsUrl(origin, base, { setup: JSON.stringify(source) })
		const page = await loadPresetPage(link, base, fetcher)
		expect(page!.workspace).toEqual(source.workspace)
		expect(page!.clock).toEqual(source.clock)
	})

	it("configures devices, chains and ordered steps, then applies shorthand overrides", async () => {
		const config = {
			devices: { "url-output-speech-synthesis": { volume: 0.5, interruption: false } },
			chains: { "url-chain": { name: "Melody" } },
			steps: { "url-chain": { "0": { trackIndex: 2, loop: true }, "1": { distance: 12 } } }
		}
		const link = createPartsUrl(origin, base, {
			midi: "midi/ode-to-joy.mid",
			outputs: "speech-synthesis",
			transformers: "Transposer",
			config: JSON.stringify(config),
			track: "1",
			loop: "false"
		})
		const page = await loadPresetPage(link, base, fetcher)
		expect(page!.workspace.devices.at(-1).definition.options).toEqual(
			config.devices["url-output-speech-synthesis"]
		)
		expect(page!.workspace.chains[0].options.name).toBe("Melody")
		expect(steps(page)[0].config).toMatchObject({ trackIndex: 1, loop: false })
		expect(steps(page)[1].config.distance).toBe(12)
	})

	it("supports empty routing and repeated ordered transformers", async () => {
		const page = await load(
			"?v=1&inputs=none&outputs=none&transformers=Transposer&transformers=Transposer"
		)
		expect(page!.workspace.devices).toEqual([])
		expect(steps(page)).toHaveLength(2)
	})

	it("preserves ensemble channel allocation when selecting another MIDI file", async () => {
		const page = await load(
			"presets/activities/ensemble-any-song-gamepads/parts/v1/midi/midi%2Fode-to-joy.mid/outputs/speech-synthesis/"
		)
		expect(steps(page)[0]).toMatchObject({
			type: "Ensemble",
			config: { autoInputs: "gamepads", midiFileUrl: `${origin}${base}midi/ode-to-joy.mid` }
		})
		expect(steps(page)[0].config).not.toHaveProperty("trackIndex")
	})

	it.each([
		"parts/v2/",
		"parts/v1/outputs/",
		"parts/v1/nope/x/",
		"parts/v1/midi/%ZZ/",
		"parts/v1//x/",
		"?v=2",
		"?v=1&typo=1",
		"?v=1&bpm=",
		"?v=1&bpm=80&bpm=90",
		"?v=1&bpm=304",
		"?v=1&swing=-0.1",
		"?v=1&bars=1.5",
		"?v=1&divisions=0",
		"?v=1&outputs=unknown",
		"?v=1&inputs=unknown",
		"?v=1&transformers=unknown",
		"?v=1&outputs=moog,,describe",
		"?v=1&mode=merge",
		"?v=1&mode=replace&preset=songs/ode-to-joy",
		"?v=1&setup={}&preset=songs/ode-to-joy",
		"?v=1&preset=https://evil.test/page",
		"?v=1&preset=../secret",
		"?v=1&midi=javascript:alert(1)",
		"?v=1&midi=https://user:pass@example.test/song.mid",
		"?v=1&midi=midi/a.mid&playback=whole",
		"?v=1&midi=midi/a.mid&loop=yes",
		"?v=1&midi=midi/a.mid&track=-2",
		"?v=1&chain=missing",
		"?v=1&outputs-mode=replace",
		"?v=1&outputs=moog&outputs-mode=merge",
		'?v=1&config={"devices":[]}',
		'?v=1&config={"unknown":{}}',
		'?v=1&config={"devices":{"missing":{}}}',
		'?v=1&config={"steps":{"url-chain":{"0":{}}}}',
		'?v=1&config={"__proto__":{}}',
		"?v=1&config=invalid",
		"?v=1&setup={}"
	])("rejects invalid schema before creating devices: %s", async (path) => {
		await expect(load(path)).rejects.toThrow()
	})

	it("retains query-only composition through static-host redirects and restores the readable path", async () => {
		const path = "presets/songs/never-gonna-give-you-up/parts/v1/outputs/speech-synthesis/"
		const html = roomFallbackHtml(`${base}room/`, `${base}play/`)
		const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
		const location = {
			origin,
			pathname: base + path,
			search: "?bpm=100",
			hash: "#room=jam",
			replace: vi.fn()
		}
		runInNewContext(script, {
			URL,
			location,
			document: { getElementById: () => ({ href: "" }) }
		})
		const redirected = location.replace.mock.calls[0][0]
		const restored = restorePartsUrl(redirected, base)
		expect(restored.href).toBe(`${origin}${base}${path}?bpm=100#room=jam`)
		const page = await loadPresetPage(redirected, base, fetcher)
		expect(page!.clock.bpm).toBe(100)
		expect(page!.workspace.chains[0].outputs).toContain("url-output-speech-synthesis")
	})

	it("keeps room invitations at the app root from dynamic links", () => {
		const url = createRoomUrl(`${origin}${base}parts/v1/outputs/moog/`, { roomId: "jam" })
		expect(new URL(url).pathname).toBe(`${base}room/`)
	})

	it.each(["https://evil.test/parts/v1/", "../parts/v1/", "parts/v1/?bad", "parts/v1/\\bad"])(
		"rejects redirect escapes: %s",
		(path) => {
			expect(() =>
				restorePartsUrl(`${origin}${base}?parts-route=${encodeURIComponent(path)}`, base)
			).toThrow()
		}
	)

	it("keeps unrelated ordinary links outside the strict schema", () => {
		expect(parsePartsUrl(`${origin}${base}?ignored=1`, base)).toBeUndefined()
		expect(
			parsePartsUrl(`${origin}${base}?midi=midi/a.mid#outputs=speech-synthesis`, base)
		).toBeUndefined()
	})

	it("accepts an intentionally empty exported workspace", async () => {
		const source = structuredClone(pages.get("presets/songs/ode-to-joy")!)
		source.workspace = { version: 2, activeChainId: null, devices: [], chains: [] }
		const page = await loadPresetPage(
			createPartsUrl(origin, base, { setup: JSON.stringify(source) }),
			base,
			fetcher
		)
		expect(page!.workspace).toEqual(source.workspace)
	})

	it("loads the API guide's clickable setup examples and generated JavaScript examples", async () => {
		const guide = readFileSync("../../docs/preset-url-api.md", "utf8")
		const urls = [
			...guide.matchAll(/\]\((https:\/\/designerzen\.github\.io\/harmoneasy\/[^)]+)\)/g)
		]
			.map((match) => match[1])
			.filter((url) => url.includes("/parts/") || url.includes("?v="))
		const generated: string[] = []
		for (const block of guide.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)) {
			runInNewContext(block[1], {
				URL,
				URLSearchParams,
				console: { log: (url: string) => generated.push(url) }
			})
		}
		expect(urls.length).toBeGreaterThanOrEqual(10)
		expect(generated).toHaveLength(2)
		const remote = vi.fn(async (url: string) =>
			url.includes("/api/midi/get")
				? Response.json({
						result: {
							result: {
								name: "Rickroll.mid",
								url: "/rickroll-mid",
								downloadUrl: "/uploads/rickroll.mid"
							}
						}
					})
				: url.includes("bitmidi.com/api")
					? Response.json({
							result: {
								results: [
									{
										name: "Rickroll.mid",
										url: "/rickroll-mid",
										downloadUrl: "/uploads/rickroll.mid"
									}
								],
								total: 1,
								pageTotal: 1
							}
						})
					: fetcher(url)
		)
		vi.stubGlobal("fetch", remote)
		try {
			for (const url of [...urls, ...generated]) {
				const page = await loadPresetPage(url, base, remote)
				expect(page, url).toBeDefined()
				expect(() => parsePresetPage(JSON.stringify(page)), url).not.toThrow()
			}
		} finally {
			vi.unstubAllGlobals()
		}
	})
})