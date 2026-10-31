import type IOChainManager from "audiobus/io/IO-chain-manager"
import { parsePresetPage, type PresetPage } from "./preset-page"
import { presetFileRoute } from "../../scripts/preset-file-routes.js"

export function exportPublishedPreset(
	manager: IOChainManager,
	path: string,
	name: string,
	description: string,
	clock: PresetPage["clock"],
	midiControls: PresetPage["midiControls"] = { enabled: true, bindings: [] }
) {
	const relative = path.replaceAll("\\", "/").replace(/\.json$/, "")
	presetFileRoute(relative)
	const page = parsePresetPage(
		JSON.stringify({
			format: "harmoneasy-preset",
			version: 1,
			name: name.trim(),
			description: description.trim(),
			workspace: manager.exportWorkspaceData(),
			clock,
			midiControls
		})
	)
	return {
		json: JSON.stringify(page, null, "\t") + "\n",
		filename: `${relative.split("/").at(-1)}.json`,
		repositoryPath: `app/harmoneasy/presets/${relative}.json`
	}
}