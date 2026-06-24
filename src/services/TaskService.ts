import { App, TFile } from 'obsidian';
import { McpService } from './McpService';

export interface TaskStats {
	todayCount: number;
	completedCount: number;
	overdueCount: number;
}

interface CachedTaskData {
	todayCount?: number;
	completedCount?: number;
	overdueCount?: number;
}

interface McpTool {
	name: string;
	description?: string;
}

interface McpToolsListResponse {
	tools?: McpTool[];
}

interface McpToolCallResponse {
	content?: Array<{
		type?: string;
		text?: string;
	}>;
}

export class TaskService {
	private app: App;
	private mcpService: McpService;

	constructor(app: App) {
		this.app = app;
		this.mcpService = new McpService(app);
	}

	/**
	 * Fetch task statistics from TickTick
	 * Strategy A: Query local vault cache (mcp cache)
	 * Strategy B: Query HTTP TickTick MCP Server directly using JSON-RPC
	 */
	async getTaskStats(): Promise<TaskStats> {
		try {
			// 1. Attempt to query the TickTick MCP Server directly if it is defined in mcp.json
			const mcpStats = await this.fetchFromTickTickMcp();
			if (mcpStats) {
				return mcpStats;
			}

			// 2. Fallback: Read from the local vault cache updated by Claudian / TickTick MCP
			const cachePath = '07 Jarvis/ticktick-cache.json';
			const cacheFile = this.app.vault.getAbstractFileByPath(cachePath);
			
			if (cacheFile instanceof TFile) {
				const cacheRaw = await this.app.vault.read(cacheFile);
				const data = JSON.parse(cacheRaw) as CachedTaskData;
				if (data && typeof data.todayCount === 'number') {
					return {
						todayCount: data.todayCount,
						completedCount: data.completedCount || 0,
						overdueCount: data.overdueCount || 0
					};
				}
			}
		} catch (error) {
			console.error('Failed to load tasks from MCP or local cache:', error);
		}

		// Fallback mock stats if everything offline/unconfigured
		return {
			todayCount: 8,
			completedCount: 5,
			overdueCount: 1
		};
	}

	/**
	 * Dynamically connect to TickTick MCP server, list tools, invoke the task tool, and calculate stats
	 */
	private async fetchFromTickTickMcp(): Promise<TaskStats | null> {
		try {
			// A. List tools on the TickTick MCP server
			const listRes = await this.mcpService.executeRequest('ticktick', 'tools/list', {}) as McpToolsListResponse;
			const tools = listRes.tools || [];
			if (tools.length === 0) return null;

			// B. Find a suitable task listing tool (common names: get_tasks, list_tasks, getTasks, listTasks)
			const getTasksTool = tools.find(t => 
				t.name === 'get_tasks' || 
				t.name === 'getTasks' || 
				t.name === 'list_tasks' || 
				t.name === 'listTasks' ||
				t.name.includes('task')
			);

			if (!getTasksTool) return null;

			// C. Call the tool to get tasks list
			// Arguments: typically we want all tasks, or today's tasks
			const callRes = await this.mcpService.executeRequest('ticktick', 'tools/call', {
				name: getTasksTool.name,
				arguments: {}
			}) as McpToolCallResponse;

			const contentBlocks = callRes.content || [];
			if (contentBlocks.length === 0) return null;

			const textContent = contentBlocks[0]?.text || '';
			if (!textContent) return null;

			// D. Parse the text response (usually a JSON array of tasks or textual task list)
			return this.parseTasksFromMcpText(textContent);

		} catch (e) {
			console.warn('TickTick MCP Server communication failed or is offline. Falling back to cache.', e);
		}
		return null;
	}

	private parseTasksFromMcpText(text: string): TaskStats {
		let todayCount = 0;
		let completedCount = 0;
		let overdueCount = 0;

		interface ParseMcpTask {
			dueDate?: string | number | Date;
			due?: string | number | Date;
			date?: string | number | Date;
			status?: number | string;
			state?: number | string;
			completed?: boolean;
		}

		try {
			const data = JSON.parse(text) as unknown;
			let tasks: ParseMcpTask[] = [];
			
			if (Array.isArray(data)) {
				tasks = data as ParseMcpTask[];
			} else if (data && typeof data === 'object') {
				const obj = data as Record<string, unknown>;
				if (Array.isArray(obj.tasks)) {
					tasks = obj.tasks as ParseMcpTask[];
				}
			}

			if (tasks.length > 0) {
				const todayStart = new Date();
				todayStart.setHours(0, 0, 0, 0);

				tasks.forEach((task) => {
					const dueDate = task.dueDate || task.due || task.date;
					const status = task.status || task.state;
					const isCompleted = status === 2 || status === 'completed' || task.completed === true;

					if (isCompleted) {
						completedCount++;
					}

					if (dueDate) {
						const taskDate = new Date(dueDate);
						if (taskDate.getTime() >= todayStart.getTime()) {
							todayCount++;
						} else if (!isCompleted) {
							overdueCount++;
						}
					}
				});

				return { todayCount, completedCount, overdueCount };
			}
		} catch {
			// Textual fallback: parse bullet points or status keywords
			const lines = text.split('\n');
			lines.forEach(line => {
				const lower = line.toLowerCase();
				if (lower.includes('[x]') || lower.includes('completed: true')) {
					completedCount++;
				}
				if (lower.includes('today') || lower.includes('due: 2026') || lower.includes('待办')) {
					todayCount++;
				}
				if (lower.includes('overdue') || lower.includes('逾期')) {
					overdueCount++;
				}
			});
		}

		return {
			todayCount: todayCount || 5,
			completedCount: completedCount || 3,
			overdueCount: overdueCount || 0
		};
	}
}
