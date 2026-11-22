import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const root = new URL("../../../", import.meta.url)

// Commit time is stable across local, shallow CI and repeated builds of the same revision.
export function buildVersionPlugin() {
	const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
	const [timestamp, revision] = execFileSync("git", ["show", "-s", "--format=%ct %H", "HEAD"], {
		cwd: root,
		encoding: "utf8"
	})
		.trim()
		.split(" ")
	const buildVersion = `${version}+${timestamp}`
	return {
		name: "build-version",
		config() {
			return { define: { __APP_VERSION__: JSON.stringify(buildVersion) } }
		},
		buildStart() {
			console.log(`Building Harmoneasy v${buildVersion} (${revision.slice(0, 8)})`)
		},
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "version.json",
				source: JSON.stringify({ version: buildVersion, revision }) + "\n"
			})
		}
	}
}
