import { createRequire } from "node:module"
import { chromium } from "playwright"
import { mkdtemp, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import assert from "node:assert/strict"

const root = fileURLToPath(new URL("../", import.meta.url))
const { build } = await import(
	pathToFileURL(
		createRequire(new URL("../../../app/harmoneasy/package.json", import.meta.url)).resolve(
			"vite"
		)
	).href
)
const output = await mkdtemp(join(tmpdir(), "harmoneasy-control-surface-"))
await build({
	root,
	configFile: false,
	logLevel: "error",
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(root, "tests/browser-entry.ts"),
			name: "SurfaceSmoke",
			formats: ["iife"],
			fileName: () => "surface.js"
		}
	}
})
const html = join(output, "index.html")
await writeFile(
	html,
	'<!doctype html><html lang="en"><meta charset="utf-8"><title>Surface test</title><link rel="stylesheet" href="control-surface.css"><script defer src="surface.js"></script></html>'
)
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.SURFACE_BROWSER_EXECUTABLE,
	args: [
		"--enable-unsafe-webgpu",
		"--enable-unsafe-swiftshader",
		"--use-webgpu-adapter=swiftshader",
		"--ignore-gpu-blocklist"
	]
})
try {
	const page = await browser.newPage({ viewport: { width: 960, height: 10000 } }),
		errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.goto(pathToFileURL(html).href)
	await page.waitForFunction(
		() =>
			document.querySelector(".cs-gpu-ready") ||
			document.querySelector(".cs-status")?.textContent,
		{ timeout: 20000 }
	)
	assert.equal(
		await page.locator(".cs-status").textContent(),
		"",
		"GPU initialization must compile shaders and create a working render pipeline"
	)
	assert.equal(await page.locator(".cs-widget").count(), 18)
	await page.waitForFunction(
		() => document.querySelector(".control-surface").dataset.hands === "2"
	)
	await page.evaluate(() => {
		const { surface } = window.surfaceSmoke
		const accents = new Map()
		for (const entry of surface.entries) {
			const id = entry.visual.sourceId
			const cached = surface.renderer.cache.get(entry.visual)
			const accent = Array.from(cached.data.slice(8, 11)).join(",")
			if (accents.has(id) && accents.get(id) !== accent) {
				throw new Error("Controls from one source have inconsistent GPU accents")
			}
			accents.set(id, accent)
		}
		if (accents.size !== 3 || new Set(accents.values()).size !== 3) {
			throw new Error("Source themes did not reach GPU instance data")
		}
	})
	await page.evaluate(async () => {
		const { surface } = window.surfaceSmoke
		const renderer = surface.renderer
		const visuals = surface.entries.map((entry) => entry.visual)
		renderer.prepare(visuals, true)
		const queue = renderer.device.queue
		const original = queue.writeBuffer.bind(queue)
		let uploads = 0
		queue.writeBuffer = (...args) => {
			uploads++
			return original(...args)
		}
		try {
			renderer.prepare(visuals, true)
			if (uploads !== 0) {
				throw new Error("Idle widgets must reuse their GPU geometry")
			}
			const dial = visuals[0],
				previous = dial.value
			dial.value = dial.descriptor.max
			renderer.prepare(visuals, true)
			const data = renderer.instances
			let found = false
			for (let offset = 0; offset < data.length; offset += 20) {
				if (data[offset + 4] === 1) {
					if (data[offset + 5] !== 1) {
						throw new Error("Dial must reach its target in the first frame")
					}
					found = true
					break
				}
			}
			if (!found || uploads !== 1) {
				throw new Error("Changed widget must upload its new geometry once")
			}
			dial.value = previous
		} finally {
			queue.writeBuffer = original
		}
		// An in-flight engine read must never overwrite a newer pointer write.
		const entry = surface.entries[0],
			originalRead = entry.binding.read
		let complete
		entry.binding.read = () =>
			new Promise((resolve) => {
				complete = resolve
			})
		entry.dirty = true
		surface.updateFeedback()
		surface.pointerDown(77, 90, 90)
		surface.pointerMove(77, 90, 55)
		const requested = entry.visual.value
		complete(60)
		await Promise.resolve()
		if (entry.visual.value !== requested) {
			throw new Error("Stale read overwrote live input")
		}
		surface.pointerUp(77)
		entry.binding.read = originalRead
	})
	await page.evaluate(async () => {
		const { surface } = window.surfaceSmoke,
			entry = surface.entries[0],
			renderer = surface.renderer
		const original = entry.binding.write
		let writes = 0
		entry.binding.write = (value) => {
			writes++
			const normalized = Math.log(value / 60) / Math.log(5000 / 60)
			const data = renderer.instances
			for (let offset = 0; offset < data.length; offset += 20) {
				if (data[offset + 4] === 1) {
					if (Math.abs(data[offset + 5] - normalized) > 0.0001) {
						throw new Error(
							"Engine work ran before the latest dial position was submitted"
						)
					}
					break
				}
			}
			return original(value)
		}
		surface.pointerDown(78, 90, 100)
		for (let i = 0; i < 100; i++) {
			surface.pointerMove(78, 90, 100 - i / 2)
		}
		if (writes !== 0) {
			throw new Error("Pointer bursts must not invoke the engine per event")
		}
		await new Promise(requestAnimationFrame)
		if (writes !== 1) {
			throw new Error("Pointer burst must commit its latest value once per frame")
		}
		surface.pointerUp(78)
		entry.binding.write = original
		const visuals = surface.entries.map((item) => item.visual),
			width = surface.stage.clientWidth,
			height = surface.height
		renderer.prepare(visuals, false)
		renderer.render(width, height, 0, false)
		const queue = renderer.device.queue,
			submit = queue.submit.bind(queue)
		let submissions = 0
		queue.submit = (...args) => {
			submissions++
			return submit(...args)
		}
		try {
			renderer.render(width, height, 1, false)
			if (submissions !== 0) {
				throw new Error("An idle surface must not continually submit GPU frames")
			}
		} finally {
			queue.submit = submit
		}
	})
	await page.evaluate(async () => {
		const { surface } = window.surfaceSmoke,
			renderer = surface.renderer
		const settle = async () => {
			await new Promise(requestAnimationFrame)
			await new Promise(requestAnimationFrame)
		}
		const before = renderer.instanceCount
		surface.options.beatPosition = () => 2
		await settle()
		if (Math.abs(renderer.frameData[21] - 0.3) > 0.00001) {
			throw new Error("Beat cue does not reach GPU uniforms")
		}
		surface.options.beatPosition = () => 2.25
		await settle()
		if (renderer.frameData[21] >= 0.02) {
			throw new Error("Beat cue does not fade between beats")
		}
		surface.options.state.beatCues = false
		await settle()
		if (renderer.frameData[21] !== 0) {
			throw new Error("Beat cues cannot be disabled")
		}
		surface.options.state.beatCues = true
		surface.options.beatPosition = () => undefined
		await settle()
		if (renderer.frameData[21] !== 0 || renderer.instanceCount !== before) {
			throw new Error("Stopping the clock changes gadget geometry or leaves a beat cue")
		}
	})
	const canvas = page.locator("canvas"),
		rect = await canvas.boundingBox()
	// Start in the panel's title area, well outside the drawn dial.
	const beforePanelDrag = await page.evaluate(() => window.surfaceSmoke.values.cutoff)
	await page.mouse.move(rect.x + 3, rect.y + 14)
	await page.mouse.down()
	await page.mouse.move(rect.x + 3, rect.y + 49)
	await page.mouse.up()
	await page.waitForFunction(
		(previous) => window.surfaceSmoke.values.cutoff < previous,
		beforePanelDrag
	)
	await page.getByRole("spinbutton", { name: "Tempo" }).fill("140")
	await page.getByRole("spinbutton", { name: "Tempo" }).press("Tab")
	await page.waitForFunction(() => window.surfaceSmoke.values.number === 140)
	await page.getByRole("combobox", { name: "Preset", exact: true }).selectOption("1")
	await page.waitForFunction(() => window.surfaceSmoke.values.preset === 1)
	const padWidget = page.locator(".cs-widget").filter({ has: page.locator(".cs-pad") })
	await padWidget.scrollIntoViewIfNeeded()
	const padRect = await padWidget.boundingBox(),
		cdp = await page.context().newCDPSession(page)
	const point = { x: padRect.x + padRect.width / 2, y: padRect.y + 90, id: 1, force: 0.25 }
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] })
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 0.25)
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchMove",
		touchPoints: [{ ...point, x: point.x + 24, force: 0.75 }]
	})
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 0.75)
	await page.evaluate(() => {
		const { surface } = window.surfaceSmoke
		surface.renderer.prepare(
			surface.entries.map((entry) => entry.visual),
			true
		)
		const data = surface.renderer.instances
		for (let offset = 0; offset < data.length; offset += 20) {
			if (data[offset + 4] === 10) {
				if (data[offset + 5] !== 0.75 || data[offset + 7] !== 1) {
					throw new Error("Pad light must follow pressure in the first frame")
				}
				return
			}
		}
		throw new Error("Pad GPU geometry is missing")
	})
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 0)
	await page.getByRole("button", { name: "Edit layout", exact: true }).click()
	assert.equal(await page.getByRole("button", { name: /Dial options/ }).count(), 0)
	assert.equal(await page.getByRole("combobox", { name: "Dial mode", exact: true }).count(), 0)
	await page.getByRole("button", { name: "Perform", exact: true }).click()
	await page.evaluate(async () => {
		const { ControlSurface, createPanControl, createRotationControl } = window.surfaceSmoke
		const descriptors = [
			createPanControl({
				id: "pan",
				label: "Pan",
				dial: { ticks: 12, tickDirection: "both", reverse: true }
			}),
			createRotationControl({ id: "rotation", label: "Rotation" })
		]
		const variant = new ControlSurface({
			state: {
				id: "procedural",
				name: "Procedural",
				connections: [],
				widgets: descriptors.map((d) => ({ key: d.id }))
			},
			bindings: descriptors.map((descriptor) => ({
				key: descriptor.id,
				sourceLabel: "Procedural",
				descriptor,
				read: () => descriptor.defaultValue,
				write: () => {}
			})),
			change: () => {}
		})
		document.body.append(variant.element)
		try {
			const deadline = performance.now() + 15000
			while (!variant.element.classList.contains("cs-gpu-ready")) {
				if (performance.now() > deadline) {
					throw new Error("Procedural widgets failed GPU initialization")
				}
				await new Promise(requestAnimationFrame)
			}
			variant.renderer.prepare(
				variant.entries.map((item) => item.visual),
				false
			)
			for (const [index, entry] of variant.entries.entries()) {
				const data = variant.renderer.cache.get(entry.visual).data
				let found = false
				for (let offset = 0; offset < data.length; offset += 20) {
					if (data[offset + 4] === 1) {
						const sweep = index === 0 ? Math.PI : Math.PI * 2
						if (
							data[offset + 6] !== index + 1 ||
							Math.abs(data[offset + 17] - sweep) > 0.00001
						) {
							throw new Error("Procedural mode did not reach the GPU")
						}
						if (
							index === 0 &&
							(data[offset + 12] !== 12 ||
								data[offset + 18] !== 1 ||
								data[offset + 19] !== 2)
						) {
							throw new Error("Procedural style did not reach the GPU")
						}
						found = true
						break
					}
				}
				if (!found) {
					throw new Error("Procedural dial geometry missing")
				}
			}
		} finally {
			variant.destroy()
		}
	})
	await cdp.detach()
	const roll = page.getByRole("grid", { name: "Piano roll", exact: true })
	await roll.getByRole("button").first().focus()
	await page.keyboard.press("Space")
	await page.waitForFunction(() => window.surfaceSmoke.values.roll[0] === 1)
	await page.keyboard.press("ArrowRight")
	await page.keyboard.press("+")
	await page.waitForFunction(() => Math.abs(window.surfaceSmoke.values.roll[1] - 0.1) < 0.001)
	const tab = page.getByRole("grid", { name: "Guitar tab", exact: true })
	await tab.getByRole("button").first().focus()
	await page.keyboard.press("7")
	await page.waitForFunction(() => window.surfaceSmoke.values.tab[0] === 7)
	await page.keyboard.press("Delete")
	await page.waitForFunction(() => window.surfaceSmoke.values.tab[0] === -1)
	const revealAction = async (action) =>
		page.evaluate((action) => {
			const { surface } = window.surfaceSmoke
			surface.focusLayout(
				surface.options.state.widgets.find((w) => w.key === "density"),
				action
			)
		}, action)
	// Rotate a panel, resize it by keyboard, and preserve focus after sorting.
	await page.getByRole("button", { name: "Edit layout", exact: true }).click()
	await revealAction("Rotate")
	await page.getByRole("button", { name: "Rotate Drum density", exact: true }).click()
	assert.equal(
		await page
			.locator(".cs-widget")
			.filter({ has: page.locator(".cs-slider") })
			.evaluate((el) => el.style.transform),
		"rotate(90deg)"
	)
	await revealAction("Resize")
	await page.getByRole("button", { name: "Resize Drum density", exact: true }).press("ArrowDown")
	await revealAction("Move later")
	await page.getByRole("button", { name: "Move later Drum density", exact: true }).click()
	assert.equal(
		await page
			.getByRole("button", { name: "Move later Drum density", exact: true })
			.evaluate((el) => el === document.activeElement),
		true
	)
	await revealAction("Move earlier")
	await page.getByRole("button", { name: "Move earlier Drum density", exact: true }).click()
	await revealAction("Resize")
	const resizeHandle = page.getByRole("button", { name: "Resize Drum density", exact: true })
	await resizeHandle.scrollIntoViewIfNeeded()
	const handleRect = await resizeHandle.boundingBox(),
		layoutTouch = await page.context().newCDPSession(page)
	const resizePoint = {
		x: handleRect.x + handleRect.width / 2,
		y: handleRect.y + handleRect.height / 2,
		id: 91,
		force: 1
	}
	await layoutTouch.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [resizePoint]
	})
	await layoutTouch.send("Input.dispatchTouchEvent", {
		type: "touchMove",
		touchPoints: [{ ...resizePoint, y: resizePoint.y + 32 }]
	})
	await layoutTouch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
	await page.waitForFunction(
		() =>
			window.surfaceSmoke.surface.options.state.widgets.find((w) => w.key === "density")
				.height >= 220
	)
	await resizeHandle.press("Enter")
	const sizeDialog = page.getByRole("dialog", { name: "Drum density size", exact: true })
	await sizeDialog.getByRole("spinbutton", { name: "Height in pixels", exact: true }).fill("228")
	await sizeDialog.getByRole("button", { name: "Increase height", exact: true }).click()
	await sizeDialog.getByRole("button", { name: "Decrease height", exact: true }).click()
	await sizeDialog.getByRole("button", { name: "Apply size", exact: true }).click()
	assert.equal(await resizeHandle.evaluate((el) => el === document.activeElement), true)
	await revealAction("Drag")
	const moveHandle = page.getByRole("button", { name: "Drag Drum density", exact: true })
	const moveRect = await moveHandle.boundingBox(),
		targetRect = await page
			.locator(".cs-widget")
			.filter({ has: page.locator(".cs-radio") })
			.boundingBox()
	const movePoint = {
		x: moveRect.x + moveRect.width / 2,
		y: moveRect.y + moveRect.height / 2,
		id: 92,
		force: 1
	}
	await layoutTouch.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [movePoint]
	})
	await layoutTouch.send("Input.dispatchTouchEvent", {
		type: "touchMove",
		touchPoints: [
			{
				...movePoint,
				x: targetRect.x + targetRect.width / 2,
				y: targetRect.y + targetRect.height / 2
			}
		]
	})
	await layoutTouch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
	await page.waitForFunction(
		() => window.surfaceSmoke.surface.options.state.widgets[3].key === "density"
	)
	await layoutTouch.detach()
	await revealAction("Move earlier")
	await page.getByRole("button", { name: "Move earlier Drum density", exact: true }).click()
	await revealAction("Move earlier")
	await page.getByRole("button", { name: "Move earlier Drum density", exact: true }).click()
	await page.getByRole("button", { name: "Perform", exact: true }).click()
	// Actual touch contacts share an anchor and retain it when the first finger lifts.
	const relativeWidget = page
		.locator(".cs-widget")
		.filter({ has: page.locator(".cs-relative-keys") })
	await relativeWidget.scrollIntoViewIfNeeded()
	const relativeBox = await relativeWidget.boundingBox()
	const touch = await page.context().newCDPSession(page)
	const rootPoint = { x: relativeBox.x + 90, y: relativeBox.y + 100, id: 101, force: 0.3 }
	const secondPoint = {
		...rootPoint,
		x: rootPoint.x + 48,
		y: rootPoint.y - 48,
		id: 102,
		force: 0.8
	}
	await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [rootPoint] })
	await touch.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [rootPoint, secondPoint]
	})
	await page.waitForFunction(() => window.surfaceSmoke.values.relative.length === 12)
	await page.evaluate(() => {
		const entry = window.surfaceSmoke.surface.entries.find(
			(e) => e.visual.widget === "relative-keys"
		)
		const contacts = [...entry.visual.relative.contacts.values()]
		if (
			contacts[0].note !== 60 ||
			contacts[1].note !== 66 ||
			Math.abs(contacts[1].pressure - 0.8) > 0.01
		) {
			throw new Error("Relative touch notes or pressure are incorrect")
		}
	})
	await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [secondPoint] })
	await page.waitForFunction(() => window.surfaceSmoke.values.relative.length === 7)
	await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
	await page.waitForFunction(() => window.surfaceSmoke.values.relative.length === 0)
	const atNote = relativeWidget.getByRole("button", { name: "Play C4", exact: true })
	await atNote.evaluate((el) => el.click())
	await page.waitForFunction(() => window.surfaceSmoke.values.relative.length === 7)
	await atNote.evaluate((el) => el.click())
	await page.waitForFunction(() => window.surfaceSmoke.values.relative.length === 0)
	const strings = page.locator(".cs-widget").filter({ has: page.locator(".cs-strum") })
	await strings.getByRole("button", { name: "Pluck String 1: E4", exact: true }).focus()
	await page.keyboard.press("Space")
	await page.waitForFunction(() => window.surfaceSmoke.values.strum[1] === 0)
	await page.keyboard.press("ArrowDown")
	await page.keyboard.press("Enter")
	await page.waitForFunction(() => window.surfaceSmoke.values.strum[1] === 1)
	await page.evaluate(() => document.activeElement.blur())
	await strings.scrollIntoViewIfNeeded()
	const stringBox = await strings.boundingBox(),
		strumTouch = await page.context().newCDPSession(page)
	const stringPoint = {
		x: stringBox.x + stringBox.width / 2,
		y: stringBox.y + 36,
		id: 201,
		force: 0.65
	}
	await strumTouch.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [stringPoint]
	})
	await strumTouch.send("Input.dispatchTouchEvent", {
		type: "touchMove",
		touchPoints: [{ ...stringPoint, y: stringBox.y + stringBox.height - 16 }]
	})
	await page.waitForFunction(() => window.surfaceSmoke.values.strum[1] === 5)
	await strumTouch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
	await strumTouch.detach()
	await touch.detach()
	const keyboardNote = relativeWidget.getByRole("button", { name: "Play C4", exact: true })
	await keyboardNote.focus()
	await page.keyboard.down("Space")
	await page.waitForFunction(() => window.surfaceSmoke.values.relative.length === 7)
	await page.keyboard.up("Space")
	await page.waitForFunction(() => window.surfaceSmoke.values.relative.length === 0)
	if (process.env.SURFACE_AXE_PATH) {
		await page.addScriptTag({ content: await readFile(process.env.SURFACE_AXE_PATH, "utf8") })
		const audit = await page.evaluate(async () => {
			const result = await axe.run(document, {
				runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] }
			})
			return {
				violations: result.violations.map((v) => ({
					id: v.id,
					impact: v.impact,
					nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary }))
				})),
				incomplete: result.incomplete.map((v) => v.id),
				passes: result.passes.length
			}
		})
		await writeFile(join(output, "accessibility.json"), JSON.stringify(audit, null, 2))
		assert.deepEqual(audit.violations, [], JSON.stringify(audit.violations))
	}
	await page.locator(".cs-pad button").focus()
	assert.equal(await page.getByRole("button", { name: "Velocity pad", exact: true }).count(), 1)
	await page.keyboard.down("Space")
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 1)
	await page.keyboard.up("Space")
	await page.waitForFunction(() => window.surfaceSmoke.values.strike === 0)
	const beforeAuto = await page.evaluate(() => window.surfaceSmoke.surface.height)
	await page.getByRole("button", { name: "Edit layout", exact: true }).click()
	await page.getByRole("button", { name: "Auto arrange", exact: true }).click()
	await page.getByRole("button", { name: "Perform", exact: true }).click()
	assert.ok((await page.evaluate(() => window.surfaceSmoke.surface.height)) <= beforeAuto)
	await page.evaluate(() => {
		const stage = document.querySelector(".cs-stage").getBoundingClientRect()
		const rects = Array.from(document.querySelectorAll(".cs-widget"), (element) =>
			element.getBoundingClientRect()
		)
		for (let i = 0; i < rects.length; i++) {
			const a = rects[i]
			if (a.left < stage.left - 0.5 || a.right > stage.right + 0.5) {
				throw new Error("A gadget escaped the surface bounds")
			}
			for (const b of rects.slice(i + 1)) {
				if (
					a.left < b.right - 0.5 &&
					a.right > b.left + 0.5 &&
					a.top < b.bottom - 0.5 &&
					a.bottom > b.top + 0.5
				) {
					throw new Error("Auto arrangement overlaps gadgets")
				}
			}
		}
	})
	await page.evaluate(async () => {
		const { surface } = window.surfaceSmoke,
			renderer = surface.renderer
		surface.setVisualEffects({ bloom: 0, depth: 0, scanlines: 0 })
		renderer.render(surface.stage.clientWidth, surface.height, 0, false)
		if (
			renderer.frameData[20] !== 0 ||
			renderer.postData[1] !== 0 ||
			renderer.postData[2] !== 0
		) {
			throw new Error("Procedural effects cannot be disabled")
		}
		surface.setVisualEffects({ bloom: 0.6, bloomRadius: 6, depth: 0.9, scanlines: 0.025 })
		surface.entries[0].element.focus()
		const pad = surface.entries.find((entry) => entry.visual.widget === "pad").visual
		surface.pointerDown(999, pad.x + 90, pad.y + 90, false, 0.7)
		const relative = surface.entries.find(
			(entry) => entry.visual.widget === "relative-keys"
		).visual
		surface.pointerDown(1001, relative.x + 110, relative.y + 140, false, 0.3)
		surface.pointerDown(1002, relative.x + 206, relative.y + 92, false, 0.85)
		surface.pointerDown(1003, relative.x + 254, relative.y + 188, false, 0.55)
		const strum = surface.entries.find((entry) => entry.visual.widget === "strum").visual
		surface.pointerDown(1004, strum.x + 140, strum.y + 40, false, 0.7)
		surface.pointerMove(1004, strum.x + 200, strum.y + strum.height - 20, false, 0.8)
		await new Promise(requestAnimationFrame)
		await new Promise(requestAnimationFrame)
		if (
			Math.abs(renderer.frameData[20] - 0.9) > 0.00001 ||
			Math.abs(renderer.postData[1] - 0.6) > 0.00001
		) {
			throw new Error("Procedural effects did not reach GPU uniforms")
		}
	})
	const gameImage = join(output, "game-style.png")
	await page.setViewportSize({ width: 960, height: 900 })
	await page.waitForTimeout(100)
	await page.screenshot({ path: gameImage })
	await page.evaluate(() =>
		[999, 1001, 1002, 1003, 1004].forEach((id) => window.surfaceSmoke.surface.pointerUp(id))
	)
	await page.evaluate(async () => {
		await window.surfaceSmoke.surface.setEffect(
			"fn surfaceEffect(color:vec4f,uv:vec2f,time:f32)->vec4f{return vec4f(color.rgb*(0.95+0.05*sin(time+uv.y*10.0)),color.a);}"
		)
	})
	await page.evaluate(async () => {
		await window.surfaceSmoke.surface.setPostEffect(
			"fn postEffect(uv:vec2f,time:f32)->vec4f{let c=textureSampleLevel(surfaceTexture,surfaceSampler,uv,0.0);return vec4f(c.rgb*(0.98+sin(time)*0.02),c.a);}"
		)
	})
	await page.waitForTimeout(100)
	assert.deepEqual(errors, [])
	assert.equal(await page.locator(".cs-status").textContent(), "")
	const image = join(output, "surface.png")
	await page.screenshot({ path: image, fullPage: true })
	await page.locator(".cs-viewport").evaluate((element) => {
		element.style.maxHeight = ""
	})
	await page.setViewportSize({ width: 390, height: 1100 })
	await page.waitForTimeout(100)
	await page.waitForFunction(
		() => document.querySelector(".control-surface").dataset.hands === "1"
	)
	await page.evaluate(() => window.surfaceSmoke.surface.showPage(0))
	await page.getByRole("button", { name: "Next page", exact: true }).click()
	await page.evaluate(() => {
		const { surface } = window.surfaceSmoke
		if (surface.currentPage !== 1 || surface.pageCount < 2) {
			throw new Error("Missing gadget pagination")
		}
		for (const entry of surface.entries) {
			if (
				entry.element.hidden !== (entry.page !== 1) ||
				entry.element.inert !== entry.element.hidden
			) {
				throw new Error("Inactive page remains accessible")
			}
		}
		for (let page = 0; page < surface.pageCount; page++) {
			surface.showPage(page)
			const stage = surface.stage.getBoundingClientRect()
			for (const entry of surface.entries.filter((e) => e.page === page)) {
				const r = entry.element.getBoundingClientRect()
				if (
					r.left < stage.left - 0.5 ||
					r.right > stage.right + 0.5 ||
					r.top < stage.top - 0.5 ||
					r.bottom > stage.bottom + 0.5
				) {
					throw new Error("Gadget escapes its page")
				}
			}
			const targets = Array.from(
				document.querySelectorAll(
					".control-surface button, .control-surface input, .control-surface select"
				)
			).filter(
				(e) =>
					e.checkVisibility() &&
					!e.closest(".cs-semantic:not(.cs-piano-roll):not(.cs-guitar-tab)")
			)
			for (const target of targets) {
				const r = target.getBoundingClientRect()
				if (r.width < 43.99 || r.height < 43.99) {
					throw new Error(
						`Undersized target: ${target.getAttribute("aria-label")} ${r.width}x${r.height}`
					)
				}
				for (const other of targets) {
					if (target === other) {
						continue
					}
					const b = other.getBoundingClientRect(),
						dx = Math.max(0, r.left - b.right, b.left - r.right),
						dy = Math.max(0, r.top - b.bottom, b.top - r.bottom)
					if (Math.hypot(dx, dy) < 10.99) {
						throw new Error(
							`Targets too close: ${target.getAttribute("aria-label")} / ${other.getAttribute("aria-label")}`
						)
					}
				}
			}
		}
		surface.showPage(1)
		if (
			document.documentElement.scrollHeight > innerHeight ||
			document.documentElement.scrollWidth > innerWidth
		) {
			throw new Error("Surface requires scrolling")
		}
	})
	assert.equal(await page.locator(".cs-viewport").evaluate((element) => element.scrollTop), 0)
	await page.getByRole("button", { name: "Previous page", exact: true }).click()
	await page.screenshot({ path: join(output, "one-hand.png"), fullPage: true })
	if (process.env.SURFACE_AXE_PATH) {
		const mobileAudit = await page.evaluate(async () => {
			const result = await axe.run(document, {
				runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] }
			})
			return result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))
		})
		assert.deepEqual(mobileAudit, [], JSON.stringify(mobileAudit))
	}
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		true,
		"Surface must fit narrow screens"
	)
	await page.evaluate(() => window.surfaceSmoke.surface.destroy())
	assert.equal(await page.locator(".control-surface").count(), 0)
	console.log(
		JSON.stringify({
			passed: true,
			widgets: 18,
			pressurePad: true,
			shaderEffects: true,
			pointerAndKeyboard: true,
			gameStyle: gameImage,
			screenshot: image
		})
	)
} finally {
	await browser.close()
}