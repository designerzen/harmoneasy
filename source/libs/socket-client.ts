/**
 * Socket Client for Frontend
 * Handles WebSocket communication with Electron main process
 */

export interface SocketMessage {
	type: string;
	payload?: any;
	id?: string;
}

export interface SocketClientOptions {
	host?: string;
	port?: number;
	autoReconnect?: boolean;
	reconnectInterval?: number;
	maxReconnectAttempts?: number;
	debug?: boolean;
}

export class SocketClient {
	private ws: WebSocket | null = null;
	private host: string;
	private port: number;
	private url: string;
	private autoReconnect: boolean;
	private reconnectInterval: number;
	private maxReconnectAttempts: number;
	private reconnectAttempts: number = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private messageHandlers: Map<string, (payload: any) => void> = new Map();
	private responseHandlers: Map<string, (payload: any) => void> = new Map();
	private messageId: number = 0;
	private debug: boolean;
	private isConnected: boolean = false;
	private pendingMessages: SocketMessage[] = [];

	constructor(options: SocketClientOptions = {}) {
		this.host = options.host || 'localhost';
		this.port = options.port || 3000;
		this.url = `ws://${this.host}:${this.port}`;
		this.autoReconnect = options.autoReconnect !== false;
		this.reconnectInterval = options.reconnectInterval || 3000;
		this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
		this.debug = options.debug || false;
	}

	/**
	 * Connect to the socket server
	 */
	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.url);

				this.ws.onopen = () => {
					this.log('Connected to socket server');
					this.isConnected = true;
					this.reconnectAttempts = 0;

					// Send any pending messages
					this.flushPendingMessages();

					// Emit connection event
					this.emit('connected', {});

					resolve();
				};

				this.ws.onmessage = (event) => {
					this.handleMessage(event.data);
				};

				this.ws.onerror = (event) => {
					this.log('Socket error:', event);
					this.emit('error', { error: 'WebSocket error' });
				};

				this.ws.onclose = () => {
					this.log('Disconnected from socket server');
					this.isConnected = false;
					this.emit('disconnected', {});

					if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
						this.attemptReconnect();
					}
				};
			} catch (error) {
				this.log('Connection error:', error);
				reject(error);
			}
		});
	}

	/**
	 * Attempt to reconnect to the server
	 */
	private attemptReconnect() {
		this.reconnectAttempts++;
		this.log(`Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

		this.reconnectTimer = setTimeout(() => {
			this.connect().catch((err) => {
				this.log('Reconnection failed:', err);
			});
		}, this.reconnectInterval * this.reconnectAttempts);
	}

	/**
	 * Handle incoming messages
	 */
	private handleMessage(data: string | ArrayBuffer) {
		try {
			let messageStr: string;

			// Handle both text and binary frames
			if (typeof data === 'string') {
				messageStr = data;
			} else if (data instanceof ArrayBuffer) {
				messageStr = new TextDecoder().decode(data);
			} else {
				this.log('Unknown message type:', typeof data);
				return;
			}

			const message: SocketMessage = JSON.parse(messageStr);
			this.log('Received:', message.type);

			// Check if this is a response to a previous request
			if (message.id && this.responseHandlers.has(message.id)) {
				const handler = this.responseHandlers.get(message.id);
				handler?.(message.payload);
				this.responseHandlers.delete(message.id);
			}

			// Emit message to registered handlers
			if (this.messageHandlers.has(message.type)) {
				const handler = this.messageHandlers.get(message.type);
				handler?.(message.payload);
			}

			// Emit generic message event
			this.emit('message', message);
		} catch (error) {
			this.log('Message parsing error:', error);
		}
	}

	/**
	 * Send a message to the server
	 */
	send(type: string, payload?: any): void {
		const message: SocketMessage = { type, payload };

		if (!this.isConnected || !this.ws) {
			this.log('Not connected, queueing message:', type);
			this.pendingMessages.push(message);
			return;
		}

		if (this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message));
			this.log('Sent:', type);
		} else {
			this.pendingMessages.push(message);
		}
	}

	/**
	 * Send a message and wait for a response
	 */
	request(type: string, payload?: any, timeout: number = 5000): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = String(++this.messageId);
			const message: SocketMessage = { type, payload, id };

			// Register response handler
			const timeoutHandle = setTimeout(() => {
				this.responseHandlers.delete(id);
				reject(new Error(`Request ${type} timed out after ${timeout}ms`));
			}, timeout);

			this.responseHandlers.set(id, (responsePayload) => {
				clearTimeout(timeoutHandle);
				resolve(responsePayload);
			});

			// Send the message
			if (!this.isConnected || !this.ws) {
				this.pendingMessages.push(message);
			} else if (this.ws.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify(message));
				this.log('Sent request:', type);
			} else {
				this.pendingMessages.push(message);
			}
		});
	}

	/**
	 * Register a handler for a specific message type
	 */
	on(messageType: string, handler: (payload: any) => void): void {
		this.messageHandlers.set(messageType, handler);
	}

	/**
	 * Register a handler for any message
	 */
	onMessage(handler: (message: SocketMessage) => void): void {
		this.on('message', handler);
	}

	/**
	 * Emit an event
	 */
	private emit(event: string, data: any) {
		const handler = this.messageHandlers.get(`_event:${event}`);
		handler?.(data);
	}

	/**
	 * Register event handlers
	 */
	onConnected(handler: () => void): void {
		this.on('_event:connected', handler);
	}

	onDisconnected(handler: () => void): void {
		this.on('_event:disconnected', handler);
	}

	onError(handler: (error: any) => void): void {
		this.on('_event:error', handler);
	}

	/**
	 * Flush pending messages
	 */
	private flushPendingMessages() {
		while (this.pendingMessages.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
			const message = this.pendingMessages.shift();
			if (message) {
				this.ws.send(JSON.stringify(message));
				this.log('Flushed message:', message.type);
			}
		}
	}

	/**
	 * Disconnect from the server
	 */
	disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}
		this.autoReconnect = false;
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.isConnected = false;
		this.log('Disconnected');
	}

	/**
	 * Get connection status
	 */
	getConnected(): boolean {
		return this.isConnected;
	}

	/**
	 * Ping the server
	 */
	async ping(): Promise<any> {
		return this.request('ping', { timestamp: Date.now() });
	}

	/**
	 * Get server info
	 */
	async getServerInfo(): Promise<any> {
		return this.request('get-server-info');
	}

	/**
	 * Echo test
	 */
	async echo(data: any): Promise<any> {
		return this.request('echo', data);
	}

	/**
	 * Logging utility
	 */
	private log(...args: any[]) {
		if (this.debug) {
			console.log('[SocketClient]', ...args);
		}
	}
}

// Create a singleton instance
export const socketClient = new SocketClient({
	host: 'localhost',
	port: 3000,
	autoReconnect: true,
	debug: true
});
