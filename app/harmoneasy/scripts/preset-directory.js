import { readFileSync } from "node:fs"
import { resolve } from "node:path"
const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(character) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;"
			})[character]
	)
const unique = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b))
const title = (value) =>
	value.replace(
		/(^|-)([a-z])/g,
		(_, space, letter) => `${space ? " " : ""}${letter.toUpperCase()}`
	)

/** Aliases share a page object in the engine catalogue; list each setup once. */
export function presetDirectoryEntries(pages, staticPages = new Map()) {
	const grouped = new Map()
	for (const [route, page] of pages) {
		if (!grouped.has(page)) {
			grouped.set(page, { route, page, aliases: [] })
		}
		grouped.get(page).aliases.push(route)
	}
	const records = [...grouped.values()]
	for (const [route, page] of staticPages) {
		const existing = records.find((record) => record.aliases.includes(route))
		if (existing) {
			existing.page = page
		} else {
			records.push({ route, page, aliases: [route] })
		}
	}
	return records
		.map(({ route, page, aliases }) => {
			const devices = page.workspace.devices
			const deviceTypes = (direction) =>
				unique(
					devices
						.filter((device) => device.direction === direction)
						.map((device) => device.definition.type ?? device.definition.factory)
				)
			return {
				route,
				aliases,
				name: page.name,
				description: page.description,
				category: title(route.replace(/^(presets|preset)\//, "").split("/")[0]),
				bpm: page.clock.bpm,
				chains: page.workspace.chains.length,
				inputs: deviceTypes("input"),
				outputs: deviceTypes("output"),
				transformers: unique(
					page.workspace.chains.flatMap((chain) =>
						JSON.parse(chain.transformers).map(
							(step) => (typeof step === "string" ? JSON.parse(step) : step).type
						)
					)
				)
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name))
}

const TOKENS = readFileSync(resolve(import.meta.dirname, "../source/assets/style/tokens.css"), "utf8")
const PAGE_STYLE = `
@font-face{font-family:"IBM Plex Sans Condensed";src:url("FONT_BASEIBMPlexSansCondensed-Regular.ttf") format("truetype");font-weight:400;font-display:swap}
@font-face{font-family:"IBM Plex Sans Condensed";src:url("FONT_BASEIBMPlexSansCondensed-SemiBold.ttf") format("truetype");font-weight:600;font-display:swap}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:var(--col-bg);color:var(--col-fg);font:400 var(--text-md)/1.5 var(--font-ui)}
a{color:var(--col-accent);text-underline-offset:.2em}a:hover{color:var(--col-accent-hover)}
button,input,select{font:inherit}
:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.shell{max-width:1200px;margin:auto;padding:0 1.5rem}
.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-block:.75rem;border-bottom:var(--border)}
.brand{display:inline-flex;align-items:center;gap:.5rem;color:var(--col-fg);font-size:var(--text-lg);font-weight:600;text-decoration:none}
.app-link{font-size:var(--text-sm)}
.intro{max-width:44rem;padding:2.5rem 0 1.5rem}
.eyebrow{margin:0 0 .5rem;color:var(--col-muted);font-size:var(--text-sm);font-weight:600}
h1{margin:0 0 .75rem;font-size:var(--text-3xl);font-weight:600;line-height:1.15;text-wrap:balance}
.intro p:last-child{margin:0;color:var(--col-muted);font-size:var(--text-lg)}
.filters{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:.75rem;padding:.75rem;background:var(--col-surface);border:var(--border);border-radius:var(--radius-lg)}
.filters label{display:grid;gap:.25rem;color:var(--col-muted);font-size:var(--text-sm);font-weight:600}
input,select{width:100%;min-width:0;min-height:var(--control-height);padding:.375rem .625rem;border:1px solid var(--col-line-strong);border-radius:var(--radius-sm);background:var(--col-surface);color:var(--col-fg)}
::placeholder{color:var(--col-muted);opacity:1}
.results-bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 0;color:var(--col-muted);font-size:var(--text-sm)}
.clear{min-height:var(--control-height);padding:.25rem .75rem;border:var(--border);border-radius:var(--radius-sm);background:var(--col-surface);color:var(--col-fg);font-size:var(--text-sm);font-weight:500;cursor:pointer}
.clear:hover{background:var(--col-surface-raised);border-color:var(--col-line-strong)}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;padding-bottom:3rem}
.preset{display:flex;flex-direction:column;min-width:0;padding:1rem;background:var(--col-surface);border:var(--border);border-radius:var(--radius-md);transition:border-color var(--time-medium)}
.preset:hover{border-color:var(--col-accent)}
.card-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem;color:var(--col-muted);font-size:var(--text-xs)}
.category{font-weight:600}
h2{margin:.5rem 0;font-size:var(--text-xl);font-weight:600;line-height:1.2}
h2 a{color:var(--col-fg);text-decoration:none}h2 a:hover{color:var(--col-accent)}
.description{margin:0 0 1rem;color:var(--col-muted);font-size:var(--text-sm)}
dl{display:grid;gap:.25rem;margin:auto 0 0;font-size:var(--text-sm)}
dl div{display:grid;grid-template-columns:3rem 1fr;gap:.5rem}
dt{color:var(--col-muted)}dd{margin:0;overflow-wrap:anywhere}
.transformers{margin:.75rem 0 0;color:var(--col-muted);font-size:var(--text-xs);overflow-wrap:anywhere}
.preset footer{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1rem;padding-top:.75rem;border-top:var(--border);font-size:var(--text-sm)}
.open{font-weight:600}.json{color:var(--col-muted)}
.empty{padding:3rem 1rem;color:var(--col-muted);text-align:center}
.site-footer{display:flex;flex-wrap:wrap;gap:.5rem 1rem;padding:1.5rem 0 2rem;border-top:var(--border);color:var(--col-muted);font-size:var(--text-sm)}
@media(max-width:1000px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.search{grid-column:1/-1}}
@media(max-width:640px){.shell{padding:0 1rem}.intro{padding-top:1.5rem}.cards,.filters{grid-template-columns:1fr}.search{grid-column:auto}}
`

export function presetDirectoryHtml(entries, base, client) {
	const href = (path) => escapeHtml(`${base}${path}`)
	const options = (values) =>
		unique(values)
			.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
			.join("")
	const cards = entries
		.map((entry) => {
			const search = [
				entry.name,
				entry.description,
				...entry.aliases,
				...entry.inputs,
				...entry.outputs,
				...entry.transformers
			]
				.join(" ")
				.toLowerCase()
			return `<article class="preset" data-search="${escapeHtml(search)}" data-category="${escapeHtml(entry.category)}" data-inputs="${escapeHtml(JSON.stringify(entry.inputs))}" data-outputs="${escapeHtml(JSON.stringify(entry.outputs))}">
			<div class="card-top"><span class="category">${escapeHtml(entry.category)}</span><span>${entry.bpm} BPM · ${entry.chains} ${entry.chains === 1 ? "chain" : "chains"}</span></div>
			<h2><a href="${href(`${entry.route}/`)}">${escapeHtml(entry.name)}</a></h2>
			<p class="description">${escapeHtml(entry.description)}</p>
			<dl><div><dt>Input</dt><dd>${escapeHtml(entry.inputs.join(", ") || "None")}</dd></div><div><dt>Output</dt><dd>${escapeHtml(entry.outputs.join(", ") || "None")}</dd></div></dl>
			${entry.transformers.length ? `<p class="transformers">${escapeHtml(entry.transformers.join(" · "))}</p>` : ""}
			<footer><a class="open" href="${href(`${entry.route}/`)}">Open preset <span aria-hidden="true">↗</span></a><a class="json" href="${href(`${entry.route}/preset.json`)}">Preset JSON</a></footer>
		</article>`
		})
		.join("\n")
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light"><title>Preset directory · Harmoneasy</title>
<meta name="description" content="Find Harmoneasy instruments, hardware setups and performance presets. Filter by input, output or category, then open a complete setup.">
<link rel="icon" type="image/svg+xml" href="${href("favicon.svg")}">
<script>try{const t=JSON.parse(localStorage.getItem("harmoneasy.theme"));if(typeof t?.hue==="number")document.documentElement.style.setProperty("--theme-hue",t.hue);if(t?.mode)document.documentElement.dataset.themeMode=t.mode}catch{}</script>
<style>
${TOKENS}
${PAGE_STYLE.replaceAll("FONT_BASE", href("fonts/"))}
</style>
</head>
<body><div class="shell"><header class="top"><a class="brand" href="${href("")}"><img src="${href("favicon.svg")}" alt="" width="24" height="24">Harmoneasy</a><a class="app-link" href="${href("")}">Open the app ↗</a></header>
<main id="preset-directory"><section class="intro"><p class="eyebrow">Preset directory</p><h1>Find a setup.<br>Make it your own.</h1><p>Explore instruments, hardware setups and complete performance rooms. Pick a preset to open its chains, sounds and controls in Harmoneasy.</p></section>
<form class="filters" role="search" onsubmit="return false">
<label class="search">Search presets<input type="search" name="q" placeholder="Name, controller, sound or transformer…" autocomplete="off"></label>
<label>Category<select name="category"><option value="">All categories</option>${options(entries.map((entry) => entry.category))}</select></label>
<label>Input<select name="input"><option value="">All inputs</option>${options(entries.flatMap((entry) => entry.inputs))}</select></label>
<label>Output<select name="output"><option value="">All outputs</option>${options(entries.flatMap((entry) => entry.outputs))}</select></label>
</form>
<div class="results-bar"><span id="result-count" role="status" aria-live="polite">${entries.length} presets</span><button class="clear" type="button" id="clear-filters">Clear filters</button></div>
<div class="cards">${cards}</div><p class="empty" id="no-results" hidden>No presets match these filters. Try another search or clear your filters.</p>
<noscript><p>All preset links are available above. Enable JavaScript to filter them.</p></noscript></main>
<div class="site-footer">Built from the same presets as the app.<a href="${href("presets/index.json")}">Browse catalogue JSON</a></div></div>
<script type="module">${client}
mountPresetDirectory(document.getElementById("preset-directory"));</script>
</body></html>`
}