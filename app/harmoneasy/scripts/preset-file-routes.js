/** Repository filenames determine URLs; JSON cannot choose an external location. */
export function presetFileRoute(path) {
	const relative = path.replaceAll("\\", "/").replace(/\.json$/, "")
	if (
		!/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/.test(relative) ||
		/(?:^|\/)index$/.test(relative)
	) {
		throw new Error(`Invalid preset filename: ${path}`)
	}
	return relative.startsWith("hardware/") ? relative : `presets/${relative}`
}

export function presetRouteAliases(route) {
	const aliases = [route, `preset/${route.replace(/^presets\//, "")}`]
	if (route.startsWith("hardware/")) {
		aliases.push(`presets/${route}`)
	}
	if (route.startsWith("presets/inputs/")) {
		aliases.push(route.replace("presets/inputs/", "hardware/"))
	}
	return aliases
}

export function presetFilePages(files) {
	const pages = new Map()
	for (const [path, page] of files) {
		for (const route of presetRouteAliases(presetFileRoute(path))) {
			if (pages.has(route)) {
				throw new Error(`Duplicate preset route: ${route}`)
			}
			pages.set(route, page)
		}
	}
	return pages
}