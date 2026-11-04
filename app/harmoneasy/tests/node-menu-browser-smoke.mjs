import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"

const app = fileURLToPath(new URL("../", import.meta.url))
const packageRequire = createRequire(
	new URL("../../../packages/control-surface/package.json", import.meta.url)
)
const { chromium } = packageRequire("playwright")
const appRequire = createRequire(new URL("../package.json", import.meta.url))
const output = await mkdtemp(join(tmpdir(), "harmoneasy-node-menu-"))
const entry = join(output, "entry.tsx")
await writeFile(
	entry,
	`
import React, {useState} from ${JSON.stringify(appRequire.resolve("react"))}
import {createRoot} from ${JSON.stringify(appRequire.resolve("react-dom/client"))}
import {NodeHeader} from ${JSON.stringify(resolve(app, "source/components/graph/NodeHeader.tsx"))}
import ${JSON.stringify(resolve(app, "source/assets/style/options.scss"))}
import ${JSON.stringify(resolve(app, "source/assets/style/node-graph.scss"))}
import ${JSON.stringify(resolve(app, "source/assets/style/dialog.scss"))}
function Node() {
 const [selection, select] = useState(0)
 return <section className="graph-node can-remove" data-selection={selection} onClick={() => select(value => value + 1)}>
  <NodeHeader title="Input" removeLabel="Remove input" onSwap={() => {window.menuAction = 'swap'}} onRemove={() => {window.menuAction = selection}}>
   <button type="button" className="device-expand">Expand</button>
  </NodeHeader>
 </section>
}
createRoot(document.getElementById("root")).render(<Node />)
`
)
await build({
	root: app,
	configFile: false,
	logLevel: "error",
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	resolve: { alias: { "react/jsx-runtime": appRequire.resolve("react/jsx-runtime") } },
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: { entry, name: "MenuSmoke", formats: ["iife"], fileName: () => "menu.js" }
	}
})
const css = (await readdir(output)).find((name) => name.endsWith(".css"))
const html = join(output, "index.html")
await writeFile(
	html,
	`<!doctype html><html lang="en"><meta charset="utf-8"><title>Node menu regression</title>
<link rel="stylesheet" href="${css}"><style>:root{color-scheme:dark}body{background:var(--col-bg);color:var(--col-fg);padding:24px}.graph-node{width:340px}#outside{position:fixed;left:24px;bottom:24px}</style>
<main id="root"></main><button id="outside">Outside</button><script defer src="menu.js"></script></html>`
)
const browser = await chromium.launch({
	headless: true,
	executablePath: process.env.SURFACE_BROWSER_EXECUTABLE
})
try {
	const page = await browser.newPage({ viewport: { width: 800, height: 680 } })
	const errors = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.goto(pathToFileURL(html).href)
	const trigger = page.getByRole("button", { name: "Node actions", exact: true })
	await trigger.waitFor({ timeout: 10000 }).catch((error) => {
		throw new Error(`${error.message}\nPage errors: ${errors.join("; ")}`)
	})
	const originalId = await trigger.getAttribute("id")
	await trigger.click()
	await page.waitForFunction(
		() => document.querySelector(".graph-node")?.dataset.selection === "1"
	)
	assert.equal(
		await trigger.getAttribute("id"),
		originalId,
		"Selection must not recreate the menu"
	)
	assert.equal(
		await trigger.getAttribute("aria-expanded"),
		"true",
		"First click must open the menu"
	)
	const panel = page.getByRole("menu", { name: "Node actions", exact: true })
	assert.equal(await panel.isVisible(), true)
	assert.deepEqual(
		await panel.evaluate((element) => {
			const style = getComputedStyle(element, "::backdrop")
			return [style.backgroundColor, style.backdropFilter, style.pointerEvents]
		}),
		["rgba(0, 0, 0, 0)", "none", "none"]
	)
	assert.equal(
		await trigger.evaluate((element) => {
			const rect = element.getBoundingClientRect()
			return element.contains(
				document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
			)
		}),
		true,
		"The menu backdrop must not cover its trigger"
	)
	await trigger.click()
	assert.equal(await trigger.getAttribute("aria-expanded"), "false")
	await trigger.click()
	await page.getByRole("menuitem", { name: "Remove input", exact: true }).click()
	assert.equal(
		await page.evaluate(() => window.menuAction),
		3,
		"Actions must use the latest render's callback"
	)
	await trigger.click()
	await page.keyboard.press("Escape")
	assert.equal(await trigger.evaluate((element) => element === document.activeElement), true)
	await trigger.click()
	await page.getByRole("button", { name: "Outside", exact: true }).click()
	assert.equal(await trigger.getAttribute("aria-expanded"), "false")
	assert.equal(
		await page.evaluate(() => {
			const dialog = document.createElement("dialog")
			dialog.textContent = "Modal check"
			document.body.append(dialog)
			dialog.showModal()
			const blur = getComputedStyle(dialog, "::backdrop").backdropFilter
			dialog.close()
			dialog.remove()
			return blur
		}),
		"blur(20px)",
		"Real modal dialogs retain their backdrop"
	)
	assert.deepEqual(errors, [])
	console.log(
		JSON.stringify({
			passed: true,
			firstClick: true,
			transparentBackdrop: true,
			latestActions: true,
			escapeAndOutside: true
		})
	)
} finally {
	await browser.close()
}