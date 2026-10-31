import type IOChainManager from "audiobus/io/IO-chain-manager"
import { DEFAULT_HARMONY, NOTE_NAMES, SCALE_FAMILIES, STRING_TUNINGS, chordTab, fretboard, inferHarmony, parseSections, scaleNeighbours, type HarmonicSection } from "audiobus/io/harmony"
import { mapPitchSet, pitchClasses } from "audiobus/tuning/pitch-class-set"
import { TransformerChordTrack } from "audiobus/io/transformers/transformer-chord-track"
import { musicalCommand } from "audiobus/io/event-clip"
import { INPUT_EVENT, NOTE_ON, NOTE_OFF } from "audiobus/commands"
import { EVENT_CHANGE, EVENT_CLOSE, EVENT_HARMONY_CHANGED, EVENT_HARMONY_SETTINGS_CHANGED, EVENT_WORKSPACE_RESTORED, EVENT_POINTER_DOWN, EVENT_POINTER_MOVE, EVENT_POINTER_UP } from "audiobus/event-constants"
import { action, download, element, field, numberField, onChange, section, selectField } from "./music-tools-dom"
import { mountDawBridge } from "./harmony-daw"

export function mountHarmonyWorkspace(manager: IOChainManager, context: AudioContext, getBpm: () => number, setTempo: (bpm: number) => void) {
	const abort = new AbortController()
	const dialog = element("dialog")
	dialog.className = "harmony-workspace"
	dialog.setAttribute("aria-label", "Harmony workspace")
	const status = element("p")
	status.setAttribute("role", "status")
	const open = action("Harmony", () => { refresh(); dialog.showModal() }, status)
	const parent = document.getElementById("btn-settings")?.parentElement ?? document.body
	parent.append(open)
	document.body.append(dialog)
	dialog.append(element("h2", "Harmony workspace"), action("Close", () => dialog.close(), status), status)
	const live = section(dialog, "Current scale and chord")
	;(live.parentElement as HTMLDetailsElement).open = true
	live.append(element("p", "Choose scale and chord independently. Add a follower to each part, then choose whether its melody follows the scale or the chord."))
	const tonic = selectField(live, "Tonic", NOTE_NAMES.map((name, root) => ({ name, value: String(root) })))
	onChange(tonic, () => {
		const previous = manager.harmony
		const root = Number(tonic.value)
		manager.setHarmony({ root, scale: mapPitchSet(previous.scale, 1, root - previous.root), chord: mapPitchSet(previous.chord, 1, root - previous.root) })
	})
	const family = selectField(live, "Scale family", [{ name: "Custom", value: "custom" }, ...SCALE_FAMILIES.map((f) => ({ name: f.name, value: String(f.mask) }))])
	onChange(family, () => {
		if (family.value !== "custom") manager.setHarmony({ ...manager.harmony, scale: mapPitchSet(Number(family.value), 1, manager.harmony.root) })
	})
	const pitchControls = element("div")
	live.append(pitchControls)
	live.append(action("Audition chord", () => audition(pitchClasses(manager.harmony.chord).map((p) => 60 + p)), status))
	live.append(action("Add live harmony follower to selected chain", () => {
		const chain = manager.activeChain
		if (!chain) throw new Error("Select a chain first")
		chain.appendTransformer(new TransformerChordTrack({ source: "live", follow: "scale" }))
		status.textContent = "Follower added. Open Shared Chord Track to choose scale, chord, bass or chords."
	}, status))
	const noteTimers = new Map<ReturnType<typeof setTimeout>, () => void>()
	async function audition(notes: number[]) {
		await context.resume()
		const output = manager.activeChain?.outputManager
		if (!output) throw new Error("Select a chain with an instrument to audition")
		await output.triggerAudioCommandsOnOutputs(notes.map((number) => musicalCommand({ type: NOTE_ON, number, velocity: 85, channel: 1, from: "harmony-audition" })))
		const release = () => { void output.triggerAudioCommandsOnOutputs(notes.map((number) => musicalCommand({ type: NOTE_OFF, number, velocity: 0, channel: 1, from: "harmony-audition" }))) }
		const timer = setTimeout(() => { noteTimers.delete(timer); release() }, 400)
		noteTimers.set(timer, release)
	}
	const networkHost = section(dialog, "Scale network")
	const dimensions = selectField(networkHost, "View", [{ name: "2D", value: "2" }, { name: "3D", value: "3" }])
	const rotation = numberField(networkHost, "Rotation", 0, -180, 180, 5)
	const zoom = numberField(networkHost, "Zoom", 1, 0.5, 1.8, 0.1)
	const network = element("div")
	network.className = "harmony-network"
	network.setAttribute("aria-label", "Related scales; choose a node to change scale")
	networkHost.append(element("p", "Connections show related collections. Closer candidates change fewer pitch classes; choosing one keeps chord selection independent."), network)
	function renderNetwork() {
		network.replaceChildren()
		const candidates = scaleNeighbours(manager.harmony).slice(0, 19)
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
		svg.setAttribute("viewBox", "0 0 100 100")
		svg.setAttribute("preserveAspectRatio", "none")
		svg.setAttribute("aria-hidden", "true")
		network.append(svg)
		const angle = Number(rotation.value) * Math.PI / 180
		candidates.forEach((candidate, i) => {
			const theta = i * Math.PI * 2 / Math.max(1, candidates.length - 1)
			const radius = i === 0 ? 0 : (25 + candidate.distance * 2) * Number(zoom.value)
			const x = Math.cos(theta) * radius
			const y = Math.sin(theta) * radius
			const depth = dimensions.value === "3" ? Math.sin(theta * 2) * 14 : 0
			const px = 50 + x * Math.cos(angle) - depth * Math.sin(angle)
			const py = 50 + y * (dimensions.value === "3" ? 0.7 : 1)
			const line = document.createElementNS(svg.namespaceURI, "line")
			for (const [key, value] of Object.entries({ x1: 50, y1: 50, x2: px, y2: py })) line.setAttribute(key, String(value))
			svg.append(line)
			const node = action(candidate.name, () => manager.setHarmony({ ...manager.harmony, root: candidate.root, scale: candidate.scale }), status)
			node.style.left = `${px}%`; node.style.top = `${py}%`
			node.style.zIndex = String(Math.round(depth + 20))
			node.setAttribute("aria-pressed", String(candidate.scale === manager.harmony.scale && candidate.root === manager.harmony.root))
			node.title = `${candidate.distance} changed pitch classes`
			network.append(node)
		})
	}
	for (const control of [dimensions, rotation, zoom]) onChange(control, renderNetwork)
	const sketch = section(dialog, "Song sketchpad")
	const name = field(sketch, "Section name", element("input"))
	name.value = "Verse"; name.maxLength = 80
	const beats = numberField(sketch, "Section beats", 16, 0.25, 256, 0.25)
	const playing = field(sketch, "Follow sections with transport", element("input"))
	playing.type = "checkbox"
	const saveTools = (sections: HarmonicSection[], play = manager.musicTools.playSections) => {
		const tools = manager.musicTools
		tools.sections = parseSections(sections); tools.playSections = play
		manager.setMusicTools(tools)
	}
	onChange(playing, () => saveTools(manager.musicTools.sections, playing.checked))
	sketch.append(action("Save current harmony as section", () => {
		if (!beats.checkValidity()) throw new Error("Choose a valid section duration")
		const sections = manager.musicTools.sections
		saveTools([...sections, { ...manager.harmony, id: crypto.randomUUID(), name: name.value, beats: beats.valueAsNumber, x: 0.15 + (sections.length % 4) * 0.22, y: 0.2 + (Math.floor(sections.length / 4) % 3) * 0.3 }])
	}, status))
	const canvas = element("div")
	canvas.className = "harmony-sketch"
	const sectionsList = element("div")
	sketch.append(canvas, sectionsList)
	let drag: { id: string; node: HTMLElement; x: number; y: number } | undefined
	canvas.addEventListener(EVENT_POINTER_DOWN, (event) => {
		const node = (event.target as HTMLElement).closest<HTMLElement>("[data-section]")
		if (!node) return
		drag = { id: node.dataset.section!, node, x: 0, y: 0 }
	}, { signal: abort.signal })
	window.addEventListener(EVENT_POINTER_MOVE, (event) => {
		if (!drag) return
		const rect = canvas.getBoundingClientRect()
		drag.x = Math.max(0.05, Math.min(0.95, (event.clientX - rect.left) / Math.max(1, rect.width)))
		drag.y = Math.max(0.1, Math.min(0.9, (event.clientY - rect.top) / Math.max(1, rect.height)))
		drag.node.style.left = `${drag.x * 100}%`; drag.node.style.top = `${drag.y * 100}%`
	}, { signal: abort.signal })
	window.addEventListener(EVENT_POINTER_UP, () => {
		if (!drag) return
		const done = drag; drag = undefined
		if (done.x || done.y) saveTools(manager.musicTools.sections.map((s) => s.id === done.id ? { ...s, x: done.x, y: done.y } : s))
	}, { signal: abort.signal })
	sketch.append(action("Export sketchpad", () => download(JSON.stringify({ version: 1, sections: manager.musicTools.sections }), "harmony-sketchpad.json", "application/json"), status))
	const upload = field(sketch, "Import sketchpad", element("input")); upload.type = "file"; upload.accept = ".json"
	upload.addEventListener(EVENT_CHANGE, async () => {
		try {
			const file = upload.files?.[0]
			if (!file) return
			if (file.size > 131072) throw new Error("Sketchpad exceeds 128 KB")
			const data = JSON.parse(await file.text())
			if (data.version !== 1) throw new Error("Unsupported sketchpad")
			saveTools(parseSections(data.sections), false)
		} catch (error) { status.textContent = String(error) }
		upload.value = ""
	}, { signal: abort.signal })
	function renderSections() {
		const tools = manager.musicTools
		playing.checked = tools.playSections
		canvas.replaceChildren(); sectionsList.replaceChildren()
		tools.sections.forEach((saved, i) => {
			const node = action(`${i + 1}. ${saved.name}`, () => manager.setHarmony(saved), status)
			node.dataset.section = saved.id
			node.style.left = `${saved.x * 100}%`; node.style.top = `${saved.y * 100}%`
			canvas.append(node)
			const row = element("fieldset"); row.append(element("legend", `Section ${i + 1}`))
			const title = field(row, "Name", element("input")); title.value = saved.name; title.maxLength = 80
			onChange(title, () => saveTools(tools.sections.map((s) => s.id === saved.id ? { ...s, name: title.value } : s)))
			const length = numberField(row, "Beats", saved.beats, 0.25, 256, 0.25)
			onChange(length, () => { if (length.checkValidity()) saveTools(tools.sections.map((s) => s.id === saved.id ? { ...s, beats: length.valueAsNumber } : s)) })
			row.append(action("Recall", () => manager.setHarmony(saved), status), action("Update harmony", () => saveTools(tools.sections.map((s) => s.id === saved.id ? { ...s, ...manager.harmony } : s)), status))
			if (i) row.append(action("Move earlier", () => {
				const copy = [...tools.sections]; [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]]; saveTools(copy)
			}, status))
			row.append(action("Remove", () => saveTools(tools.sections.filter((s) => s.id !== saved.id)), status))
			sectionsList.append(row)
		})
	}
	const tabHost = section(dialog, "Fretboards and chord tablature")
	const instrument = selectField(tabHost, "Instrument", Object.keys(STRING_TUNINGS).map((name) => ({ name, value: name })))
	const tabFollow = selectField(tabHost, "Display", [{ name: "Scale", value: "scale" }, { name: "Chord", value: "chord" }])
	const position = numberField(tabHost, "Starting fret", 0, 0, 12)
	const tab = element("div"); tab.className = "harmony-fretboard"; tabHost.append(tab)
	function renderTab() {
		const tuning = STRING_TUNINGS[instrument.value as keyof typeof STRING_TUNINGS]
		const mask = manager.harmony[tabFollow.value as "scale" | "chord"]
		const grid = element("table")
		const header = element("tr"); header.append(element("th", "String"))
		for (let f = Number(position.value); f <= Number(position.value) + 4; f++) header.append(element("th", String(f)))
		grid.append(header)
		fretboard(tuning, mask, Number(position.value) + 4).slice().reverse().forEach((string, i) => {
			const row = element("tr"); row.append(element("th", NOTE_NAMES[tuning[tuning.length - 1 - i] % 12]))
			string.slice(Number(position.value)).forEach((fret) => {
				const cell = element("td")
				if (fret.active) cell.append(action(NOTE_NAMES[fret.note % 12], () => audition([fret.note]), status))
				else cell.textContent = "·"
				row.append(cell)
			}); grid.append(row)
		})
		const shape = chordTab(tuning, manager.harmony.chord, Number(position.value))
		const text = element("pre", tuning.map((open, i) => `${NOTE_NAMES[open % 12].padEnd(2)} |--${shape[i] ?? "x"}--|`).reverse().join("\n"))
		const covered = shape.reduce<number>((m, fret, i) => fret === null ? m : m | (1 << ((tuning[i] + fret) % 12)), 0)
		tab.replaceChildren(grid, element("p", "Chord shape (x = muted string)"), text)
		if (manager.harmony.chord & ~covered) tab.append(element("p", "This position omits chord tones. Try another starting fret."))
	}
	for (const control of [instrument, tabFollow, position]) onChange(control, renderTab)
	const inference = section(dialog, "Detect harmony from notes")
	inference.append(element("p", "Play MIDI or add Microphone Pitch to a chain. Candidate scales are suggestions; choose one to adopt it."))
	const listen = field(inference, "Collect notes from selected chain", element("input")); listen.type = "checkbox"
	const candidates = element("div")
	let notes: Array<{ number: number; velocity: number }> = []
	let inferenceTimer: ReturnType<typeof setTimeout> | undefined
	inference.append(action("Clear evidence", () => { notes = []; candidates.replaceChildren() }, status), candidates)
	manager.addEventListener(INPUT_EVENT, (event) => {
		if (!listen.checked) return
		const { command, chainId } = (event as CustomEvent).detail
		if (chainId !== manager.activeChainId || command.type !== NOTE_ON || command.velocity <= 0) return
		notes = [...notes.slice(-127), { number: command.number, velocity: command.velocity }]
		if (inferenceTimer) return
		inferenceTimer = setTimeout(() => {
			inferenceTimer = undefined
			candidates.replaceChildren(...inferHarmony(notes).map((candidate) => action(`${candidate.name} · ${Math.round(candidate.coverage * 100)}% of evidence in scale`, () => manager.setHarmony(candidate), status)))
		}, 200)
	}, { signal: abort.signal })
	const daw = mountDawBridge(section(dialog, "DAW connection"), manager, getBpm, setTempo)
	function refresh() {
		const state = manager.harmony ?? DEFAULT_HARMONY
		tonic.value = String(state.root)
		family.value = String(mapPitchSet(state.scale, 1, -state.root))
		if (family.selectedIndex < 0) family.value = "custom"
		pitchControls.replaceChildren()
		for (const kind of ["scale", "chord"] as const) {
			const group = element("fieldset"); group.append(element("legend", kind === "scale" ? "Scale notes" : "Chord notes"))
			NOTE_NAMES.forEach((name, pitch) => {
				const button = action(name, () => manager.setHarmony({ ...manager.harmony, [kind]: manager.harmony[kind] ^ (1 << pitch) }), status)
				button.setAttribute("aria-pressed", String(Boolean(state[kind] & (1 << pitch))))
				group.append(button)
			}); pitchControls.append(group)
		}
		renderNetwork(); renderTab()
	}
	manager.addEventListener(EVENT_HARMONY_CHANGED, refresh, { signal: abort.signal })
	for (const event of [EVENT_HARMONY_SETTINGS_CHANGED, EVENT_WORKSPACE_RESTORED]) manager.addEventListener(event, () => { refresh(); renderSections() }, { signal: abort.signal })
	dialog.addEventListener(EVENT_CLOSE, () => { listen.checked = false; drag = undefined }, { signal: abort.signal })
	refresh(); renderSections()
	return { destroy() {
		abort.abort(); clearTimeout(inferenceTimer)
		for (const [timer, release] of noteTimers) { clearTimeout(timer); release() }
		daw.destroy(); open.remove(); dialog.remove()
	} }
}
