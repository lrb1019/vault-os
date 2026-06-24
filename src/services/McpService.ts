import { App, requestUrl } from 'obsidian';

interface McpServerConfig {
	type?: string;
	url?: string;
	headers?: Record<string, string>;
}

interface McpJsonConfig {
	mcpServers?: Record<string, McpServerConfig>;
}

interface JsonRpcResponse {
	jsonrpc: string;
	id?: number;
	result?: unknown;
	error?: {
		code: number;
		message: string;
	};
}

export class McpService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Execute a JSON-RPC request to an HTTP-based MCP server defined in mcp.json
	 */
	async executeRequest(serverName: string, method: string, params: unknown): Promise<unknown> {
		const config = await this.loadServerConfig(serverName);
		if (!config || config.type !== 'http' || !config.url) {
			throw new Error(`MCP server "${serverName}" is not configured as an HTTP server in mcp.json.`);
		}

		return this.executeSseJsonRpc(config.url, config.headers || {}, method, params);
	}

	private async loadServerConfig(serverName: string): Promise<McpServerConfig | null> {
		try {
			const mcpFilePath = '.claude/mcp.json';
			if (await this.app.vault.adapter.exists(mcpFilePath)) {
				const content = await this.app.vault.adapter.read(mcpFilePath);
				const config = JSON.parse(content) as McpJsonConfig;
				return config.mcpServers?.[serverName] || null;
			}
		} catch (error) {
			console.error('Failed to read .claude/mcp.json:', error);
		}
		return null;
	}

	private executeSseJsonRpc(
		serverUrl: string,
		headers: Record<string, string>,
		method: string,
		params: unknown
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const sseUrl = `${serverUrl}/sse`;
			const requestId = Math.floor(Math.random() * 1000000);

			let messageEndpoint = '';
			let requestSent = false;
			let isAborted = false;
			let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
			
			// Set up timeout
			const timeout = window.setTimeout(() => {
				cleanup();
				reject(new Error(`MCP request timed out after 10 seconds (method: ${method})`));
			}, 10000);

			const cleanup = () => {
				window.clearTimeout(timeout);
				isAborted = true;
				if (reader) {
					void reader.cancel();
				}
			};

			// 1. Establish SSE Connection using browser fetch
			// eslint-disable-next-line no-restricted-globals
			fetch(sseUrl, {
				method: 'GET',
				headers: {
					...headers,
					'Accept': 'text/event-stream',
					'Cache-Control': 'no-cache'
				}
			})
			.then(async (res) => {
				if (res.status !== 200) {
					cleanup();
					reject(new Error(`SSE connection failed with status code: ${res.status}`));
					return;
				}

				if (!res.body) {
					cleanup();
					reject(new Error('SSE response body is null.'));
					return;
				}

				reader = res.body.getReader();
				const decoder = new TextDecoder('utf8');
				let buffer = '';

				while (!isAborted) {
					const { value, done } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					let boundary = buffer.indexOf('\n\n');
					while (boundary !== -1) {
						const block = buffer.substring(0, boundary).trim();
						buffer = buffer.substring(boundary + 2);
						
						try {
							parseSseBlock(block);
						} catch (err) {
							console.error('Failed to parse SSE block:', err);
						}
						
						boundary = buffer.indexOf('\n\n');
					}
				}
			})
			.catch((err) => {
				cleanup();
				reject(err as Error);
			});

			// SSE Block Parser
			const parseSseBlock = (block: string) => {
				const lines = block.split('\n');
				let eventType = '';
				let dataVal = '';

				for (const line of lines) {
					if (line.startsWith('event:')) {
						eventType = line.substring(6).trim();
					} else if (line.startsWith('data:')) {
						dataVal += (dataVal === '' ? '' : '\n') + line.substring(5).trim();
					}
				}

				// A. Handle endpoint resolution
				if (eventType === 'endpoint') {
					messageEndpoint = dataVal;
					sendJsonRpcRequest();
				} 
				// B. Handle message response
				else if (eventType === 'message') {
					try {
						const payload = JSON.parse(dataVal) as JsonRpcResponse;
						if (payload && payload.id === requestId) {
							cleanup();
							if (payload.error) {
								reject(new Error(payload.error.message || 'MCP Error'));
							} else {
								resolve(payload.result);
							}
						}
					} catch (e) {
						console.error('Failed to parse JSON-RPC message payload:', e);
					}
				}
			};

			// 2. Send JSON-RPC payload via HTTP POST to the endpoint resolved from SSE
			const sendJsonRpcRequest = () => {
				if (requestSent || !messageEndpoint) return;
				requestSent = true;

				const postUrl = new URL(messageEndpoint, serverUrl).toString();
				const payload = JSON.stringify({
					jsonrpc: '2.0',
					id: requestId,
					method,
					params
				});

				requestUrl({
					url: postUrl,
					method: 'POST',
					headers: {
						...headers,
						'Content-Type': 'application/json'
					},
					body: payload
				})
				.then((postRes) => {
					if (postRes.status !== 200 && postRes.status !== 202) {
						cleanup();
						reject(new Error(`Failed to POST JSON-RPC message: status ${postRes.status}`));
					}
				})
				.catch((err) => {
					cleanup();
					reject(err as Error);
				});
			};
		});
	}
}
