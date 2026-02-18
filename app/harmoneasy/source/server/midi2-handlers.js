/**
 * MIDI 2.0 Socket Message Handlers
 * Handles UMP (Universal MIDI Packet) operations over socket
 */

class MIDI2Handlers {
	constructor(socketServer) {
		this.socketServer = socketServer
		this.midi2Native = null
		this.activeDevices = new Map() // Track active device connections
		this.inputListeners = new Map() // Map device index to listeners

		// Try to load native MIDI2 module
		try {
			this.midi2Native = require('../build/Release/midi2-native.node')
			console.log('[MIDI2Handlers] Loaded native MIDI2 module')
		} catch (error) {
			console.warn('[MIDI2Handlers] Native MIDI2 module not available:', error.message)
		}
	}

	/**
	 * Register all MIDI 2.0 handlers
	 */
	registerHandlers() {
		if (!this.midi2Native) {
			console.warn('[MIDI2Handlers] Native module not loaded, skipping MIDI 2.0 handlers')
			return
		}

		this.registerOutputHandlers()
		this.registerInputHandlers()
		this.registerDiscoveryHandlers()
		this.registerCapabilityHandlers()
	}

	/**
	 * Register MIDI 2.0 output handlers
	 */
	registerOutputHandlers() {
		// Get available MIDI 2.0 outputs
		this.socketServer.on('midi2:get-outputs', (ws, payload, id) => {
			try {
				const outputs = this.midi2Native.getUmpOutputs()
				this.socketServer.send(ws, 'midi2:outputs', { outputs, id })
			} catch (error) {
				console.error('[MIDI2Handlers] Error getting outputs:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'get-outputs',
					error: error.message,
					id
				})
			}
		})

		// Open MIDI 2.0 output device
		this.socketServer.on('midi2:open-output', (ws, payload, id) => {
			try {
				const { deviceIndex } = payload
				this.midi2Native.openUmpOutput(deviceIndex)
				this.activeDevices.set(deviceIndex, { type: 'output', ws })

				this.socketServer.send(ws, 'midi2:output-opened', { deviceIndex, id })
			} catch (error) {
				console.error('[MIDI2Handlers] Error opening output:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'open-output',
					error: error.message,
					id
				})
			}
		})

		// Close MIDI 2.0 output device
		this.socketServer.on('midi2:close-output', (ws, payload, id) => {
			try {
				const { deviceIndex } = payload
				this.midi2Native.closeUmpOutput(deviceIndex)
				this.activeDevices.delete(deviceIndex)

				this.socketServer.send(ws, 'midi2:output-closed', { deviceIndex, id })
			} catch (error) {
				console.error('[MIDI2Handlers] Error closing output:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'close-output',
					error: error.message,
					id
				})
			}
		})

		// Send UMP packet
		this.socketServer.on('midi2:send-ump', (ws, payload, id) => {
			try {
				const { deviceIndex, umpPacket } = payload

				if (!Number.isInteger(umpPacket) || umpPacket < 0 || umpPacket > 0xFFFFFFFF) {
					throw new Error('Invalid UMP packet: must be a 32-bit unsigned integer')
				}

				this.midi2Native.sendUmp(deviceIndex, umpPacket)

				if (id) {
					this.socketServer.send(ws, 'midi2:ump-sent', { deviceIndex, id })
				}
			} catch (error) {
				console.error('[MIDI2Handlers] Error sending UMP:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'send-ump',
					error: error.message,
					id
				})
			}
		})

		// Send multiple UMP packets (batch)
		this.socketServer.on('midi2:send-ump-batch', (ws, payload, id) => {
			try {
				const { deviceIndex, umpPackets } = payload

				if (!Array.isArray(umpPackets)) {
					throw new Error('umpPackets must be an array')
				}

				let sentCount = 0
				for (const packet of umpPackets) {
					if (Number.isInteger(packet) && packet >= 0 && packet <= 0xFFFFFFFF) {
						this.midi2Native.sendUmp(deviceIndex, packet)
						sentCount++
					}
				}

				this.socketServer.send(ws, 'midi2:ump-batch-sent', {
					deviceIndex,
					sentCount,
					totalCount: umpPackets.length,
					id
				})
			} catch (error) {
				console.error('[MIDI2Handlers] Error sending UMP batch:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'send-ump-batch',
					error: error.message,
					id
				})
			}
		})
	}

	/**
	 * Register MIDI 2.0 input handlers
	 */
	registerInputHandlers() {
		// Get available MIDI 2.0 inputs
		this.socketServer.on('midi2:get-inputs', (ws, payload, id) => {
			try {
				const inputs = this.midi2Native.getUmpInputs()
				this.socketServer.send(ws, 'midi2:inputs', { inputs, id })
			} catch (error) {
				console.error('[MIDI2Handlers] Error getting inputs:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'get-inputs',
					error: error.message,
					id
				})
			}
		})

		// Start listening for MIDI 2.0 input
		this.socketServer.on('midi2:listen-input', (ws, payload, id) => {
			try {
				const { deviceIndex } = payload

				// Create input listener callback
				const inputListener = (inDeviceIndex, umpPacket) => {
					this.socketServer.send(ws, 'midi2:ump-input', {
						deviceIndex: inDeviceIndex,
						umpPacket,
						timestamp: Date.now()
					})
				}

				this.inputListeners.set(deviceIndex, inputListener)
				this.midi2Native.onUmpInput(inputListener)

				this.socketServer.send(ws, 'midi2:input-listening', { deviceIndex, id })
			} catch (error) {
				console.error('[MIDI2Handlers] Error starting input listener:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'listen-input',
					error: error.message,
					id
				})
			}
		})

		// Stop listening for MIDI 2.0 input
		this.socketServer.on('midi2:stop-listening-input', (ws, payload, id) => {
			try {
				const { deviceIndex } = payload
				this.inputListeners.delete(deviceIndex)

				this.socketServer.send(ws, 'midi2:input-stopped', { deviceIndex, id })
			} catch (error) {
				console.error('[MIDI2Handlers] Error stopping input listener:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'stop-listening-input',
					error: error.message,
					id
				})
			}
		})
	}

	/**
	 * Register MIDI-CI discovery handlers
	 */
	registerDiscoveryHandlers() {
		// Discover MIDI 2.0 devices (MIDI-CI)
		this.socketServer.on('midi2:discover', (ws, payload, id) => {
			try {
				const { deviceIndex } = payload

				// This would send a MIDI-CI discovery message
				// and wait for responses
				console.log(`[MIDI2Handlers] Discovering device ${deviceIndex}`)

				// TODO: Implement MIDI-CI discovery
				// For now, just acknowledge
				this.socketServer.send(ws, 'midi2:discovery-started', { deviceIndex, id })
			} catch (error) {
				console.error('[MIDI2Handlers] Error starting discovery:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'discover',
					error: error.message,
					id
				})
			}
		})

		// Get device profiles (MIDI-CI)
		this.socketServer.on('midi2:get-profiles', (ws, payload, id) => {
			try {
				const { deviceIndex } = payload

				// TODO: Implement profile querying via MIDI-CI
				// This would send a profile inquiry and collect responses

				this.socketServer.send(ws, 'midi2:profiles', {
					deviceIndex,
					profiles: [],
					id
				})
			} catch (error) {
				console.error('[MIDI2Handlers] Error getting profiles:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'get-profiles',
					error: error.message,
					id
				})
			}
		})
	}

	/**
	 * Register MIDI 2.0 capability handlers
	 */
	registerCapabilityHandlers() {
		// Get MIDI 2.0 capabilities
		this.socketServer.on('midi2:get-capabilities', (ws, payload, id) => {
			try {
				const capabilities = this.midi2Native.getCapabilities()
				this.socketServer.send(ws, 'midi2:capabilities', { capabilities, id })
			} catch (error) {
				console.error('[MIDI2Handlers] Error getting capabilities:', error)
				this.socketServer.send(ws, 'midi2:error', {
					operation: 'get-capabilities',
					error: error.message,
					id
				})
			}
		})
	}

	/**
	 * Broadcast MIDI 2.0 event to all clients
	 */
	broadcastEvent(type, payload) {
		this.socketServer.broadcast('midi2:event', {
			type,
			payload,
			timestamp: Date.now()
		})
	}

	/**
	 * Notify clients of MIDI 2.0 device change
	 */
	notifyDeviceChange(deviceIndex, changeType) {
		this.broadcastEvent('device-change', {
			deviceIndex,
			changeType // 'connected', 'disconnected'
		})
	}
}

export default MIDI2Handlers
