import { afterAll, beforeAll, expect, it, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { CLAP_PATCHES } from "../../../packages/audiobus/instruments/clap/clap-catalog"
import { resolveFilePath } from "../public/webclap/clap-audionode.mjs"

let Processor: any
let getHost: any, getWclap: any
let hostConfig: any
const root = new URL("../public/", import.meta.url)

beforeAll(async () => {
	vi.stubGlobal("document", { baseURI: "http://webclap.local/" })
	vi.stubGlobal("sampleRate", 48000)
	vi.stubGlobal("fetch", async (url: string | URL) => {
		const source = new URL(String(url))
		const path = source.pathname.slice(1)
		const bytes = await readFile(source.protocol === "file:" ? source : new URL(path, root))
		return new Response(bytes, {
			headers: {
				"Content-Type": path.endsWith(".wasm")
					? "application/wasm"
					: "application/octet-stream"
			}
		})
	})
	vi.stubGlobal(
		"AudioWorkletProcessor",
		class {
			port = { postMessage: vi.fn(), onmessage: null }
		}
	)
	vi.stubGlobal("registerProcessor", (_: string, Class: any) => {
		Processor = Class
	})
	const runtime = await import("../public/webclap/wclap-js/wclap.mjs")
	getHost = runtime.getHost
	getWclap = runtime.getWclap
	await import("../public/webclap/clap-audioworkletprocessor.mjs")
	hostConfig = await getHost(new URL("webclap/host.wasm", root).href)
})
afterAll(() => vi.unstubAllGlobals())

it.each(CLAP_PATCHES)(
	"processes real WebCLAP audio and parameters: $name",
	async (patch) => {
		const config = await getWclap("http://webclap.local" + patch.url)
		const processor = new Processor({
			processorOptions: {
				host: hostConfig,
				wclap: config,
				pluginId: patch.factory
			}
		})
		// Initialization runs asynchronously inside the worklet constructor.
		await vi.waitFor(() => expect(processor.port.postMessage).toHaveBeenCalled(), {
			timeout: 10000
		})
		const info = processor.port.postMessage.mock.calls[0][0]
		expect(info.initialError).toBeUndefined()
		expect(info.desc.id).toBe(patch.id)
		const methods = processor.remoteMethods
		const params = methods.getParams.call(processor)
		for (const param of params.filter((param: any) => !param.flags.readonly)) {
			// Preserve the factory patch: parameter defaults can differ from its values.
			const value = methods.setParam.call(processor, param.id, param.value.value)
			expect(Number.isFinite(value.value), JSON.stringify({ param, value })).toBe(true)
		}
		const synth = patch.features?.includes("instrument")
		const output = [[new Float32Array(128), new Float32Array(128)]]
		const input = [
			[
				Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 10) * 0.2),
				new Float32Array(128)
			]
		]
		let energy = 0
		try {
			const note = patch.id === "com.plinken.pulze" ? 36 : 60
			if (patch.id === "com.plinken.pulze") {
				// Exercise the same sample-upload protocol used by the drum-pad UI.
				const frames = 4800,
					payload = 32 + frames * 4
				const message = new ArrayBuffer(10 + payload),
					bytes = new Uint8Array(message),
					view = new DataView(message)
				bytes.set([0xa1, 0x63, 0x73, 0x6d, 0x70, 0x5a])
				view.setUint32(6, payload, false)
				for (const [offset, value] of [
					[10, 0x504c5350],
					[14, 1],
					[18, 1],
					[22, 48000],
					[26, 1],
					[30, frames],
					[34, 0],
					[38, frames]
				]) {
					view.setUint32(offset, value, true)
				}
				for (let i = 0; i < frames; i++) {
					view.setFloat32(42 + i * 4, Math.sin(i / 10) * 0.3, true)
				}
				await processor.port.onmessage({ data: message })
			}
			// Silence must not terminate the worklet before its first note.
			expect(processor.process(synth ? [[]] : input, output, {})).toBe(true)
			methods.sendMidi.call(processor, [0x92, note, 100])
			for (let block = 0; block < 100; block++) {
				expect(processor.process(synth ? [[]] : input, output, {})).toBe(true)
				for (const channel of output[0]) {
					for (const value of channel) {
						energy += value * value
					}
				}
			}
			expect(Number.isFinite(energy)).toBe(true)
			expect(energy).toBeGreaterThan(0)
			methods.sendMidi.call(processor, [0x82, note, 0])
			if (info.webview) {
				// Validate HTML, JS imports and stylesheets behind the UI proxy.
				const view = info.webview.startsWith("file:")
					? "file://" +
						resolveFilePath(config.files, info.webview.replace(/^file:\/*/, "/"))
					: info.webview
				const pending = [new URL(view, "https://plugin.local").href],
					seen = new Set<string>()
				while (pending.length) {
					const uri = pending.shift()!
					if (seen.has(uri)) {
						continue
					}
					seen.add(uri)
					const url = new URL(uri)
					const resource = uri.startsWith("file:")
						? config.files[url.pathname]
						: methods.getResource.call(processor, url.pathname)
					const bytes = resource?.bytes ?? resource
					expect(
						!!bytes,
						`${uri}; files: ${Object.keys(config.files).slice(0, 5).join(", ")}`
					).toBe(true)
					expect(bytes?.byteLength, uri).toBeGreaterThan(0)
					if (!/\.(html|mjs|js|css)$/.test(url.pathname)) {
						continue
					}
					const content = new TextDecoder().decode(bytes)
					for (const match of content.matchAll(
						/(?:\b(?:src|href)=|\bfrom\s+)["']([^"']+)["']/g
					)) {
						if (!match[1].startsWith(".") && !match[1].startsWith("/")) {
							continue
						}
						pending.push(new URL(match[1], uri).href)
					}
				}
			}
		} finally {
			methods.destroy.call(processor)
			expect(processor.process(input, output, {})).toBe(false)
		}
	},
	20000
)