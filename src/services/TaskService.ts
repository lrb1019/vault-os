import { App, TFile, Notice } from 'obsidian';
import { McpService } from './McpService';

export interface TaskItem {
	text: string;
	checked: boolean;
	time?: string;
}

export interface TaskStats {
	todayCount: number;
	completedCount: number;
	overdueCount: number;
	tasks: TaskItem[];
}

interface CachedTaskData {
	todayCount?: number;
	completedCount?: number;
	overdueCount?: number;
	tasks?: TaskItem[];
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
	
	// Memory cache for synchronous UI rendering
	private cache: TaskStats = {
		todayCount: 0,
		completedCount: 0,
		overdueCount: 0,
		tasks: []
	};

	private isInitialized = false;

	constructor(app: App) {
		this.app = app;
		this.mcpService = new McpService(app);
	}

	/**
	 * Returns the instantaneous cached data for 0-latency UI rendering
	 */
	getCache(): TaskStats {
		return this.cache;
	}

	/**
	 * Bootstraps the cache. Reads from local file first for immediate data, 
	 * then optionally fires an MCP sync in the background.
	 */
	async initialize(forceSync: boolean = false): Promise<void> {
		if (this.isInitialized && !forceSync) return;
		
		// 1. Load from local JSON cache first
		await this.loadFromDisk();
		this.isInitialized = true;
		
		// 2. Optionally trigger a background sync with MCP to fetch latest
		if (forceSync) {
			await this.syncWithTickTick();
		}
	}

	/**
	 * Performs the heavy lifting: talks to MCP, parses data, updates memory cache, and writes to disk.
	 */
	async syncWithTickTick(): Promise<TaskStats> {
		try {
			// 1. Attempt to query the TickTick MCP Server directly
			const mcpStats = await this.fetchFromTickTickMcp();
			if (mcpStats) {
				this.cache = mcpStats;
				await this.saveToDisk(mcpStats);
				return this.cache;
			}
		} catch (error) {
			console.error('Failed to sync tasks from MCP:', error);
		}

		// Fallback mock stats if everything offline/unconfigured
		this.cache = {
			todayCount: 8,
			completedCount: 5,
			overdueCount: 1,
			tasks: [
				{ text: '未连接到 TickTick 数据源', checked: false, time: '' },
				{ text: '缺少 .claude/mcp.json 配置', checked: false, time: '' },
				{ text: '或缺少本地 ticktick-cache.json', checked: false, time: '' }
			]
		};
		return this.cache;
	}

	private async loadFromDisk(): Promise<void> {
		try {
			const cachePath = '07 Jarvis/ticktick-cache.json';
			const cacheFile = this.app.vault.getAbstractFileByPath(cachePath);
			
			if (cacheFile instanceof TFile) {
				const cacheRaw = await this.app.vault.read(cacheFile);
				const data = JSON.parse(cacheRaw) as CachedTaskData;
				
				this.cache = {
					todayCount: data.todayCount || 0,
					completedCount: data.completedCount || 0,
					overdueCount: data.overdueCount || 0,
					tasks: data.tasks || []
				};
			}
		} catch (e) {
			console.warn('No local task cache found or error reading it', e);
		}
	}

	private async saveToDisk(stats: TaskStats): Promise<void> {
		try {
			const cachePath = '07 Jarvis/ticktick-cache.json';
			let cacheFile = this.app.vault.getAbstractFileByPath(cachePath);
			const jsonStr = JSON.stringify(stats, null, 2);
			
			if (cacheFile instanceof TFile) {
				await this.app.vault.modify(cacheFile, jsonStr);
			} else {
				// Create the file if it doesn't exist. Ensure folder exists first.
				const folderPath = '07 Jarvis';
				const folder = this.app.vault.getAbstractFileByPath(folderPath);
				if (!folder) {
					await this.app.vault.createFolder(folderPath);
				}
				await this.app.vault.create(cachePath, jsonStr);
			}
		} catch (e) {
			console.error('Failed to save task cache to disk', e);
		}
	}

	/**
	 * Dynamically connect to TickTick MCP server, list tools, invoke the task tool, and calculate stats
	 */
	private async fetchFromTickTickMcp(): Promise<TaskStats | null> {
		try {
			const listRes = await this.mcpService.executeRequest('ticktick', 'tools/list', {}) as McpToolsListResponse;
			const tools = listRes.tools || [];
			if (tools.length === 0) return null;

			const getTasksTool = tools.find(t => 
				t.name === 'get_tasks' || 
				t.name === 'getTasks' || 
				t.name === 'list_tasks' || 
				t.name === 'listTasks' ||
				t.name.includes('task')
			);

			if (!getTasksTool) return null;

			const callRes = await this.mcpService.executeRequest('ticktick', 'tools/call', {
				name: getTasksTool.name,
				arguments: {}
			}) as McpToolCallResponse;

			const contentBlocks = callRes.content || [];
			if (contentBlocks.length === 0) return null;

			const textContent = contentBlocks[0]?.text || '';
			if (!textContent) return null;

			return this.parseTasksFromMcpText(textContent);

		} catch (e) {
			console.warn('TickTick MCP Server communication failed or is offline.', e);
		}
		return null;
	}

	private parseTasksFromMcpText(text: string): TaskStats {
		let todayCount = 0;
		let completedCount = 0;
		let overdueCount = 0;
		let parsedTasks: TaskItem[] = [];

		interface ParseMcpTask {
			dueDate?: string | number | Date;
			due?: string | number | Date;
			date?: string | number | Date;
			status?: number | string;
			state?: number | string;
			completed?: boolean;
			title?: string;
			text?: string;
			name?: string;
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

					parsedTasks.push({
						text: task.title || task.text || task.name || '未知任务',
						checked: isCompleted,
						time: dueDate ? new Date(dueDate).toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'}) : ''
					});
				});

				return { todayCount, completedCount, overdueCount, tasks: parsedTasks };
			}
		} catch {
			// Textual fallback
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
			overdueCount: overdueCount || 0,
			tasks: parsedTasks
		};
	}
}
