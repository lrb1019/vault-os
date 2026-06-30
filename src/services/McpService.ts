import { App, requestUrl } from 'obsidian';
import VaultOsPlugin from '../main';

interface McpServerConfig {
	type?: string;
	url?: string;
	headers?: Record<string, string>;
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
	private plugin: VaultOsPlugin;
	private app: App;

	constructor(plugin: VaultOsPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	/**
	 * Execute a JSON-RPC request to an HTTP-based MCP server defined in mcp.json
	 */
	async executeRequest(serverName: string, method: string, params: unknown): Promise<unknown> {
		const config = await this.loadServerConfig(serverName);
		if (!config || config.type !== 'http' || !config.url) {
			throw new Error(`MCP server "${serverName}" is not configured as an HTTP server.`);
		}

		return this.executeDirectJsonRpc(config.url, config.headers || {}, method, params);
	}

	private async loadServerConfig(serverName: string): Promise<McpServerConfig | null> {
		const ticktickConfig = this.plugin.settings.ticktickMcp;
		if (serverName === ticktickConfig.serviceName && ticktickConfig.enabled) {
			return {
				type: ticktickConfig.type,
				url: ticktickConfig.url,
				headers: ticktickConfig.headers
			};
		}
		return null;
	}

	private executeDirectJsonRpc(
		serverUrl: string,
		headers: Record<string, string>,
		method: string,
		params: unknown
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const requestId = Math.floor(Math.random() * 1000000);
			const payload = JSON.stringify({
				jsonrpc: '2.0',
				id: requestId,
				method,
				params
			});

			requestUrl({
				url: serverUrl,
				method: 'POST',
				headers: {
					...headers,
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				},
				body: payload
			}).then((res) => {
				if (res.status === 200 || res.status === 202) {
					try {
						const data = ((res.json && typeof res.json === 'object') ? res.json : JSON.parse(res.text)) as unknown;
						const payload = data as JsonRpcResponse;
						if (payload.error) {
							reject(new Error(payload.error.message || 'MCP Error'));
						} else {
							resolve(payload.result);
						}
					} catch {
						reject(new Error('Failed to parse JSON-RPC response'));
					}
				} else {
					reject(new Error(`MCP request failed with status: ${res.status}`));
				}
			}).catch((err) => reject(err as Error));
		});
	}
}
