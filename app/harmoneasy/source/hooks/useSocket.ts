/**
 * React Hook for Socket Communication
 * Provides easy access to socket client in React components
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { SocketClient, SocketMessage } from '../libs/socket-client';

export interface UseSocketOptions {
	autoConnect?: boolean;
	onConnected?: () => void;
	onDisconnected?: () => void;
	onError?: (error: any) => void;
}

/**
 * Hook to use socket client in React components
 */
export function useSocket(options: UseSocketOptions = {}) {
	const clientRef = useRef<SocketClient | null>(null);
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Initialize socket client
	useEffect(() => {
		if (!clientRef.current) {
			clientRef.current = new SocketClient({
				host: 'localhost',
				port: 3000,
				autoReconnect: true,
				debug: true
			});
		}

		const client = clientRef.current;

		// Setup event handlers
		const handleConnected = () => {
			setConnected(true);
			setError(null);
			options.onConnected?.();
		};

		const handleDisconnected = () => {
			setConnected(false);
			options.onDisconnected?.();
		};

		const handleError = (errorPayload: any) => {
			setError(errorPayload.error || 'Socket error');
			options.onError?.(errorPayload);
		};

		client.onConnected(handleConnected);
		client.onDisconnected(handleDisconnected);
		client.onError(handleError);

		// Auto connect if enabled
		if (options.autoConnect !== false) {
			client.connect().catch((err) => {
				setError(err.message);
				console.error('Failed to connect:', err);
			});
		}

		// Cleanup
		return () => {
			// Don't disconnect on unmount - socket is global
		};
	}, [options]);

	// Send message
	const send = useCallback((type: string, payload?: any) => {
		if (clientRef.current) {
			clientRef.current.send(type, payload);
		}
	}, []);

	// Send request with response
	const request = useCallback(
		async (type: string, payload?: any, timeout?: number) => {
			if (clientRef.current) {
				return clientRef.current.request(type, payload, timeout);
			}
			throw new Error('Socket client not initialized');
		},
		[]
	);

	// Register message handler
	const on = useCallback((type: string, handler: (payload: any) => void) => {
		if (clientRef.current) {
			clientRef.current.on(type, handler);
		}
	}, []);

	// Connect manually
	const connect = useCallback(async () => {
		if (clientRef.current && !clientRef.current.getConnected()) {
			await clientRef.current.connect();
		}
	}, []);

	// Disconnect manually
	const disconnect = useCallback(() => {
		if (clientRef.current) {
			clientRef.current.disconnect();
		}
	}, []);

	// Ping server
	const ping = useCallback(async () => {
		if (clientRef.current) {
			return clientRef.current.ping();
		}
	}, []);

	// Get server info
	const getServerInfo = useCallback(async () => {
		if (clientRef.current) {
			return clientRef.current.getServerInfo();
		}
	}, []);

	return {
		connected,
		error,
		send,
		request,
		on,
		connect,
		disconnect,
		ping,
		getServerInfo,
		client: clientRef.current
	};
}

/**
 * Hook for listening to specific message types
 */
export function useSocketMessage(type: string, handler: (payload: any) => void) {
	const socketRef = useRef<SocketClient | null>(null);

	useEffect(() => {
		const client = socketRef.current;
		if (client) {
			client.on(type, handler);
		}
	}, [type, handler]);
}

/**
 * Hook for making socket requests
 */
export function useSocketRequest(
	type: string,
	payload?: any,
	options: { autoRequest?: boolean; timeout?: number } = {}
) {
	const [data, setData] = useState<any>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const clientRef = useRef<SocketClient | null>(null);

	const makeRequest = useCallback(async () => {
		if (!clientRef.current?.getConnected()) {
			setError('Not connected to socket server');
			return;
		}

		try {
			setLoading(true);
			setError(null);
			const result = await clientRef.current.request(
				type,
				payload,
				options.timeout
			);
			setData(result);
		} catch (err: any) {
			setError(err.message);
		} finally {
			setLoading(false);
		}
	}, [type, payload, options.timeout]);

	useEffect(() => {
		if (!clientRef.current) {
			clientRef.current = new SocketClient({
				host: 'localhost',
				port: 3000,
				autoReconnect: true
			});
		}

		if (options.autoRequest && clientRef.current.getConnected()) {
			makeRequest();
		}
	}, [options.autoRequest, makeRequest]);

	return { data, loading, error, refetch: makeRequest };
}
