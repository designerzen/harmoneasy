import type IOChainManager from "audiobus/io/IO-chain-manager"
import { parseHarmony } from "audiobus/io/harmony"
import { parseMusicTools } from "audiobus/io/music-tools"
import { encodeOSC, decodeOSC } from "audiobus/io/osc"
import {
	EVENT_OPEN,
	EVENT_CLOSE,
	EVENT_ERROR,
	EVENT_MESSAGE,
	EVENT_HARMONY_CHANGED,
	EVENT_HARMONY_SETTINGS_CHANGED
} from "audiobus/event-constants"
import { action, element, field } from "./music-tools-dom"

export function mountDawBridge(
	host: HTMLElement,
	manager: IOChainManager,
	getBpm: () => number,
	setTempo: (bpm: number) => void
) {
	const abort = new AbortController()
	const status = element("p")
	status.setAttribute("role", "status")
	host.append(
		element(
			"p",
			"Run pnpm --dir app/harmoneasy harmony:bridge, then enable the bridge in the Harmoneasy Harmony DAW plugin. For Ableton, load the supplied Max MIDI Effect patch. Connect, then choose whether to send this session or recall the DAW’s saved harmony."
		)
	)
	const url = field(host, "Local bridge", element("input"))
	url.value = "ws://127.0.0.1:9122"
	const follow = field(host, "Follow DAW tempo", element("input"))
	follow.type = "checkbox"
	let socket: WebSocket | undefined
	let applying = false
	const send = (address: string, args: Array<string | number>) => {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(encodeOSC({ address, args }))
		}
	}
	const sendState = () => {
		if (applying) {
			return
		}
		const state = manager.harmony
		send("/harmoneasy/state", [state.root, state.scale, state.chord, getBpm()])
	}
	const sendProject = () => {
		if (applying || socket?.readyState !== WebSocket.OPEN) {
			return
		}
		const project = JSON.stringify(manager.musicTools)
		if (new TextEncoder().encode(project).length > 48000) {
			status.textContent =
				"This harmonic project exceeds the DAW bridge’s 48 KB limit. Export its sketchpad to keep a copy."
			return
		}
		send("/harmoneasy/project", [project])
	}
	function disconnect() {
		const previous = socket
		socket = undefined
		previous?.close()
		status.textContent = "Disconnected"
	}
	host.append(
		action(
			"Connect DAW bridge",
			() => {
				disconnect()
				const target = new URL(url.value)
				if (
					!["ws:", "wss:"].includes(target.protocol) ||
					!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
				) {
					throw new Error("Use a local WebSocket bridge")
				}
				const current = new WebSocket(target.href)
				current.binaryType = "arraybuffer"
				socket = current
				current.addEventListener(EVENT_OPEN, () => {
					if (socket === current) {
						status.textContent =
							"Bridge connected. Send this session or recall the DAW project."
					}
				})
				current.addEventListener(EVENT_CLOSE, () => {
					if (socket === current) {
						socket = undefined
						status.textContent = "Bridge disconnected"
					}
				})
				current.addEventListener(EVENT_ERROR, () => {
					if (socket === current) {
						status.textContent = "Could not connect. Start the local harmony bridge."
					}
				})
				current.addEventListener(EVENT_MESSAGE, (event) => {
					if (socket !== current || !(event.data instanceof ArrayBuffer)) {
						return
					}
					try {
						applying = true
						for (const message of decodeOSC(new Uint8Array(event.data))) {
							if (message.address === "/harmoneasy/state") {
								const [root, scale, chord, bpm] = message.args
								manager.setHarmony(parseHarmony({ root, scale, chord }))
								if (
									follow.checked &&
									typeof bpm === "number" &&
									Number.isFinite(bpm) &&
									bpm >= 10 &&
									bpm <= 303
								) {
									setTempo(bpm)
								}
							} else if (
								message.address === "/harmoneasy/project" &&
								typeof message.args[0] === "string"
							) {
								manager.setMusicTools(parseMusicTools(JSON.parse(message.args[0])))
								status.textContent =
									"Recalled harmony and song sections from the DAW project"
							}
						}
					} catch (error) {
						status.textContent = String(error)
					} finally {
						applying = false
					}
				})
			},
			status
		),
		action(
			"Send this session to DAW",
			() => {
				sendProject()
				sendState()
			},
			status
		),
		action("Recall DAW harmony and sections", () => send("/harmoneasy/request", []), status),
		action("Disconnect DAW", disconnect, status),
		status
	)
	manager.addEventListener(EVENT_HARMONY_CHANGED, sendState, { signal: abort.signal })
	manager.addEventListener(EVENT_HARMONY_SETTINGS_CHANGED, sendProject, { signal: abort.signal })
	return {
		destroy() {
			abort.abort()
			disconnect()
		}
	}
}