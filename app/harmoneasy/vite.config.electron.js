import { defineConfig } from "vite"
import { crossOriginIsolationPlugin } from "audiobus/io/cross-origin-files.js"
import { opendawFilesPlugin } from "audiobus-output-opendaw-vaporisateur/vite"
import _path from "path"
import { midiDeviceFilesPlugin } from "audiobus/hardware/midi-devices/device-files.js"
import { supersonicFilesPlugin } from "audiobus/io/outputs/supersonic-files.js"
import { agentDocsPlugin } from "./scripts/agent-docs.js"
import { buildVersionPlugin } from "./scripts/build-version.js"

/**
 * Vite config for Electron builds
 * Used by: npm run build:electron
 *
 * This config handles native .node modules and sets up proper bundling
 * for Electron + Node.js runtime environment
 */

// Custom plugin to handle .node files - prevent bundling of native modules
const nodeAddonPlugin = {
	name: "node-addon-loader",
	resolveId(id) {
		// Externalize any .node files completely
		if (id.endsWith(".node")) {
			return { id, external: true }
		}
		// Handle relative paths that reference .node files
		if (id.includes(".node")) {
			return { id, external: true }
		}
	},
	// Prevent vite from trying to analyze .node file imports
	load(id) {
		if (id.endsWith(".node")) {
			return null
		}
	}
}

export default defineConfig({
	base: "./",
	worker: { format: "es" },
	optimizeDeps: {
		include: ["audiotool > @audiotool/nexus", "audiotool > @audiotool/nexus/utils"]
	},
	server: {
		port: 1999
	},
	build: {
		outDir: "dist-electron",
		emptyOutDir: true,
		rollupOptions: {
			external: [
				"url",
				"path",
				"fs", // Node.js built-ins
				"module" // Node.js module system
			],
			output: {
				// Preserve external module references
				preserveModules: false,
				format: "es"
			}
		},
		// Explicitly exclude node native modules from minification
		minify: "esbuild"
	},
	test: {
		setupFiles: ["./tests/midi-profile-runtime-setup.ts"],
		globals: true,
		environment: "node"
	},
	resolve: {
		conditions: ["import"]
	},
	plugins: [
		buildVersionPlugin(),
		agentDocsPlugin(),
		nodeAddonPlugin,
		midiDeviceFilesPlugin(),
		supersonicFilesPlugin(),
		crossOriginIsolationPlugin(),
		opendawFilesPlugin()
	],
	ssr: {
		external: ["fs", "path", "module", "url"]
	}
})