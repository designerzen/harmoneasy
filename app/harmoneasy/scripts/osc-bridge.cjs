// Local binary OSC bridge. Environment: OSC_WS_PORT, OSC_RECEIVE_PORT,
// OSC_SEND_PORT, OSC_ALLOWED_ORIGIN. UDP and WebSocket listeners stay on loopback.
const { createSocket } = require("node:dgram")
const { WebSocketServer, WebSocket } = require("ws")
const EVENT_MESSAGE = "message",
	EVENT_ERROR = "error",
	EVENT_CONNECTION = "connection"
const EVENT_SIGINT = "SIGINT",
	EVENT_SIGTERM = "SIGTERM"
const port = (name, fallback) => {
	const value = Number(process.env[name] ?? fallback)
	if (!Number.isInteger(value) || value < 1 || value > 65535) {
		throw new Error(`Invalid ${name}`)
	}
	return value
}
const wsPort = port("OSC_WS_PORT", 8080),
	receivePort = port("OSC_RECEIVE_PORT", 9001),
	sendPort = port("OSC_SEND_PORT", 9000)
const allowedOrigin = process.env.OSC_ALLOWED_ORIGIN ?? "http://localhost:1999"
const mirrorPort = process.env.OSC_MIRROR_PORT ? port("OSC_MIRROR_PORT", 9125) : undefined
const udp = createSocket("udp4")
const server = new WebSocketServer({
	host: "127.0.0.1",
	port: wsPort,
	maxPayload: 65536,
	verifyClient: ({ origin }) => origin === allowedOrigin
})
server.on(EVENT_CONNECTION, (socket) => {
	socket.on(EVENT_ERROR, (error) => console.error(error.message))
	socket.on(EVENT_MESSAGE, (data, binary) => {
		if (!binary || data.length < 4 || data.length > 65536 || data.length % 4) {
			socket.close(1003, "Expected a binary OSC packet")
			return
		}
		udp.send(data, sendPort, "127.0.0.1", (error) => {
			if (error) {
				console.error(error.message)
			}
		})
		if (mirrorPort) udp.send(data, mirrorPort, "127.0.0.1")
	})
})
udp.on(EVENT_MESSAGE, (data) => {
	if (data.length < 4 || data.length > 65536 || data.length % 4) {
		return
	}
	if (mirrorPort) udp.send(data, mirrorPort, "127.0.0.1")
	for (const socket of server.clients) {
		if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 262144) {
			socket.send(data)
		}
	}
})
let stopping = false
const shutdown = () => {
	if (stopping) {
		return
	}
	stopping = true
	for (const socket of server.clients) {
		socket.terminate()
	}
	server.close()
	try {
		udp.close()
	} catch {
		/* The socket may have failed before binding. */
	}
}
udp.on(EVENT_ERROR, (error) => {
	console.error(error.message)
	shutdown()
	process.exitCode = 1
})
server.on(EVENT_ERROR, (error) => {
	console.error(error.message)
	shutdown()
	process.exitCode = 1
})
udp.bind(receivePort, "127.0.0.1", () => {
	console.log(
		`OSC bridge ws://127.0.0.1:${wsPort}; UDP in ${receivePort}, out ${sendPort}; browser origin ${allowedOrigin}`
	)
})
process.once(EVENT_SIGINT, shutdown)
process.once(EVENT_SIGTERM, shutdown)
