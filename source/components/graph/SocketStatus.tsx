/**
 * Socket Status Component
 * Example component showing socket connection status and basic testing
 */

import React, { useEffect, useState } from 'react';
import { useSocket } from '../hooks/useSocket';

export function SocketStatus() {
	const { connected, error, ping, getServerInfo, send, request } = useSocket({
		autoConnect: true,
		onConnected: () => console.log('Socket connected'),
		onDisconnected: () => console.log('Socket disconnected'),
		onError: (err) => console.error('Socket error:', err)
	});

	const [serverInfo, setServerInfo] = useState<any>(null);
	const [loading, setLoading] = useState(false);
	const [messages, setMessages] = useState<string[]>([]);

	const handlePing = async () => {
		try {
			setLoading(true);
			const response = await ping();
			setMessages((prev) => [
				...prev,
				`Pong received: ${JSON.stringify(response)}`
			]);
		} catch (err: any) {
			setMessages((prev) => [...prev, `Ping failed: ${err.message}`]);
		} finally {
			setLoading(false);
		}
	};

	const handleGetServerInfo = async () => {
		try {
			setLoading(true);
			const info = await getServerInfo();
			setServerInfo(info);
			setMessages((prev) => [...prev, `Server info: ${info.clients} clients`]);
		} catch (err: any) {
			setMessages((prev) => [...prev, `Failed to get info: ${err.message}`]);
		} finally {
			setLoading(false);
		}
	};

	const handleSendMessage = () => {
		send('test-message', {
			text: 'Hello from frontend!',
			timestamp: Date.now()
		});
		setMessages((prev) => [...prev, 'Test message sent']);
	};

	const handleRequest = async () => {
		try {
			setLoading(true);
			const response = await request('echo', { data: 'test' }, 5000);
			setMessages((prev) => [...prev, `Echo response: ${JSON.stringify(response)}`]);
		} catch (err: any) {
			setMessages((prev) => [...prev, `Echo failed: ${err.message}`]);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div style={{ padding: '20px', fontFamily: 'monospace' }}>
			<h3>Socket Status</h3>

			<div
				style={{
					padding: '10px',
					marginBottom: '10px',
					backgroundColor: connected ? '#d4edda' : '#f8d7da',
					borderRadius: '4px',
					border: `1px solid ${connected ? '#28a745' : '#f5c6cb'}`
				}}
			>
				<strong>Status:</strong> {connected ? 'Connected' : 'Disconnected'}
				{error && <div style={{ color: 'red', marginTop: '5px' }}>{error}</div>}
			</div>

			{serverInfo && (
				<div
					style={{
						padding: '10px',
						marginBottom: '10px',
						backgroundColor: '#e7f3ff',
						borderRadius: '4px',
						border: '1px solid #b3d9ff'
					}}
				>
					<strong>Server Info:</strong>
					<ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
						<li>Port: {serverInfo.port}</li>
						<li>Clients: {serverInfo.clients}</li>
						<li>Platform: {serverInfo.platform}</li>
						<li>Node: {serverInfo.nodeVersion}</li>
					</ul>
				</div>
			)}

			<div style={{ marginBottom: '10px' }}>
				<button
					onClick={handlePing}
					disabled={!connected || loading}
					style={{ marginRight: '5px' }}
				>
					Ping
				</button>
				<button
					onClick={handleGetServerInfo}
					disabled={!connected || loading}
					style={{ marginRight: '5px' }}
				>
					Get Server Info
				</button>
				<button
					onClick={handleSendMessage}
					disabled={!connected || loading}
					style={{ marginRight: '5px' }}
				>
					Send Message
				</button>
				<button
					onClick={handleRequest}
					disabled={!connected || loading}
				>
					Echo Request
				</button>
			</div>

			<div
				style={{
					backgroundColor: '#f5f5f5',
					border: '1px solid #ddd',
					borderRadius: '4px',
					padding: '10px',
					maxHeight: '300px',
					overflowY: 'auto',
					fontSize: '12px'
				}}
			>
				<strong>Messages:</strong>
				{messages.length === 0 ? (
					<p style={{ color: '#999' }}>No messages yet</p>
				) : (
					<ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
						{messages.map((msg, idx) => (
							<li key={idx}>{msg}</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
