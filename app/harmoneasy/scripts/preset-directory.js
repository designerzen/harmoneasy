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
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#edf2ed;background:#101612;color-scheme:dark;font-synthesis:none}*{box-sizing:border-box}body{margin:0}a{color:inherit;text-underline-offset:4px}a:hover{color:#b7ef9b}button,input,select{font:inherit}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #b7ef9b;outline-offset:4px}[hidden]{display:none!important}.shell{max-width:1440px;padding:0 40px;margin:auto}.top{border-bottom:1px solid #344036;padding-top:24px;padding-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{font-weight:750;font-size:20px;text-decoration:none;letter-spacing:-.04em}.brand span{color:#b7ef9b}.app-link{font-size:14px;color:#bac8ba}.intro{padding:72px 0 38px;max-width:800px}.eyebrow{text-transform:uppercase;letter-spacing:.16em;color:#b7ef9b;font-size:12px;font-weight:700;margin:0 0 18px}h1{font-size:clamp(36px,5vw,66px);font-weight:550;line-height:1.05;letter-spacing:-.055em;margin:0 0 22px}.intro p:last-child{color:#bac8ba;font-size:18px;line-height:1.65;max-width:650px}.filters{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:16px;padding:24px;background:#19221b;border:1px solid #344036;border-radius:14px}.filters label{display:grid;gap:9px;font-size:12px;font-weight:600;letter-spacing:.02em;color:#bac8ba}input,select{width:100%;min-width:0;border:1px solid #465349;border-radius:7px;padding:12px;background:#111913;color:#edf2ed;min-height:46px}.results-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:24px 0;font-size:14px;color:#bac8ba}.clear{border:0;background:none;color:#b7ef9b;cursor:pointer;padding:8px;text-decoration:underline;text-underline-offset:4px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding-bottom:60px}.preset{display:flex;flex-direction:column;min-width:0;border:1px solid #344036;border-radius:12px;background:#18201a;padding:24px;transition:border-color .15s}.preset:hover{border-color:#728b69}.card-top{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;color:#a6b7a5;font-size:11px}.category{color:#b7ef9b;text-transform:uppercase;letter-spacing:.08em;font-weight:650}h2{font-size:24px;letter-spacing:-.035em;line-height:1.2;margin:22px 0 14px}h2 a{text-decoration:none}.description{font-size:14px;line-height:1.7;color:#bac8ba;margin:0 0 22px}dl{font-size:12px;line-height:1.6;display:grid;gap:8px;margin:auto 0 0}dl div{display:grid;grid-template-columns:48px 1fr;gap:10px}dt{color:#819580}dd{margin:0;overflow-wrap:anywhere}.transformers{font-size:11px;line-height:1.8;color:#819580;overflow-wrap:anywhere;margin:18px 0 0}footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:24px;padding-top:20px;border-top:1px solid #344036}.open{font-size:14px;font-weight:650;text-decoration:none;color:#b7ef9b}.json{font-size:12px;color:#a6b7a5}.empty{padding:44px 20px 70px;text-align:center;color:#bac8ba}.site-footer{border-top:1px solid #344036;padding:24px 0 36px;color:#819580;font-size:12px}.site-footer a{margin-left:20px}@media(max-width:1100px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.search{grid-column:1/-1}}@media(max-width:640px){.shell{padding:0 20px}.top{padding-top:20px;padding-bottom:20px}.intro{padding-top:44px}.cards,.filters{grid-template-columns:1fr}.filters{padding:18px}.search{grid-column:auto}.preset{padding:22px}.intro p:last-child{font-size:16px}}
</style>
</head>
<body><div class="shell"><header class="top"><a class="brand" href="${href("")}">harmon<span>easy</span></a><a class="app-link" href="${href("")}">Open the app ↗</a></header>
<main id="preset-directory"><section class="intro"><p class="eyebrow">The preset directory</p><h1>Find a setup.<br>Make it your own.</h1><p>Explore instruments, hardware setups and complete performance rooms. Pick a preset to open its chains, sounds and controls in Harmoneasy.</p></section>
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