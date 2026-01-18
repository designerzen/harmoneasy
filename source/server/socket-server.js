/**
 * Socket Server for Electron Main Process
 * Manages WebSocket connections between Electron main process and renderer processes
 * Uses uWebSockets.js for high performance
 */

import uWS from 'uWebSockets.js'

class SocketServer {
	constructor(options = {}) {
		this.port = options.port || 3000
		this.host = options.host || 'localhost'
		this.app = null
		this.listenSocket = null
		this.clients = new Set()
		this.messageHandlers = new Map()
	}

	/**
	 * Start the WebSocket server
	 */
	start() {
		this.app = uWS
			.App()
			.ws('/*', {
				/* Options */
				compression: uWS.SHARED_COMPRESSOR,
				maxPayloadLength: 16 * 1024 * 1024, // 16MB
				maxBackpressure: 1024 * 1024 * 10, // 10MB
				idleTimeout: 60,

				/* Handlers */
				open: (ws) => {
					console.log('[SocketServer] Client connected')
					this.clients.add(ws)

					// Attach client metadata
					ws.isAlive = true
					ws.id = `client_${Date.now()}_${Math.random()}`
				},

				message: (ws, message, isBinary) => {
					this.handleMessage(ws, message, isBinary)
				},

				drain: (ws) => {
					// Called when backpressure is released
					console.log('[SocketServer] Drain:', ws.getBufferedAmount())
				},

				close: (ws, code, message) => {
					console.log('[SocketServer] Client disconnected')
					this.clients.delete(ws)
				}
			})
			.listen(this.port, (socket) => {
				if (socket) {
					this.listenSocket = socket
					console.log(`[SocketServer] Listening on ws://${this.host}:${this.port}`)
					this.setupDefaultHandlers()
				} else {
					console.error(`[SocketServer] Failed to listen on port ${this.port}`)
				}
			})
	}

	/**
	 * Stop the WebSocket server
	 */
	stop() {
		if (this.listenSocket) {
			uWS.us_listen_socket_close(this.listenSocket)
		}
		this.clients.clear()
		console.log('[SocketServer] Server stopped')
	}

	/**
	 * Handle incoming messages from clients
	 */
	handleMessage(ws, rawData, isBinary) {
		try {
			const message = JSON.parse(Buffer.from(rawData).toString())
			const { type, payload, id } = message

			console.log(`[SocketServer] Received: ${type}`)

			// Handle the message
			if (this.messageHandlers.has(type)) {
				const handler = this.messageHandlers.get(type)
				handler(ws, payload, id)
			} else {
				console.warn(`[SocketServer] No handler for message type: ${type}`)
			}
		} catch (error) {
			console.error('[SocketServer] Message parsing error:', error.message)
		}
	}

	/**
	 * Register a message handler
	 */
	on(messageType, handler) {
		this.messageHandlers.set(messageType, handler)
	}

	/**
	 * Broadcast message to all connected clients
	 */
	broadcast(type, payload) {
		const message = JSON.stringify({ type, payload })
		this.clients.forEach((client) => {
			this.send(client, type, payload)
		})
	}

	/**
	 * Send message to a specific client
	 */
	send(ws, type, payload) {
		try {
			const message = JSON.stringify({ type, payload })
			const sendStatus = ws.send(message, false, false)

			// sendStatus: 1 = success, 2 = dropped due to backpressure, 0 = backpressure
			if (sendStatus === 2) {
				console.warn('[SocketServer] Message dropped due to backpressure limit')
			} else if (sendStatus === 0) {
				console.log('[SocketServer] Message queued due to backpressure')
			}
		} catch (error) {
			console.error('[SocketServer] Send error:', error.message)
		}
	}

	/**
	 * Setup default message handlers
	 */
	setupDefaultHandlers() {
		// Ping/Pong for connection health
		this.on('ping', (ws, payload, id) => {
			this.send(ws, 'pong', { timestamp: Date.now() })
		})

		// Echo message for testing
		this.on('echo', (ws, payload, id) => {
			this.send(ws, 'echo-response', payload)
		})

		// Get client info
		this.on('get-client-info', (ws, payload, id) => {
			this.send(ws, 'client-info', {
				id,
				connectedClients: this.clients.size,
				uptime: process.uptime()
			})
		})

		// Server info request
		this.on('get-server-info', (ws, payload, id) => {
			this.send(ws, 'server-info', {
				host: this.host,
				port: this.port,
				clients: this.clients.size,
				uptime: process.uptime(),
				platform: process.platform,
				nodeVersion: process.version
			})
		})
	}

	/**
	 * Get number of connected clients
	 */
	getClientCount() {
		return this.clients.size
	}
}

export default SocketServer
