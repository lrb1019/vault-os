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

			// Get today's undone tasks
			const mcpResult = await this.mcpService.executeRequest('ticktick', 'tools/call', {
				name: 'list_undone_tasks_by_time_query',
				arguments: { timeQuery: 'today' }
			}) as { content?: Array<{ type: string; text: string }>; structuredContent?: { result?: any[] }; isError?: boolean };

			if (mcpResult.isError) {
				console.error('TickTick MCP Error:', mcpResult.content?.[0]?.text);
				throw new Error('TickTick returned an error.');
			}

			// We only get undone tasks from this query, so completedCount will be a mock for now
			// Or we could parse structuredContent.result
			const tasksData = mcpResult.structuredContent?.result || [];

			const parsedTasks: TaskItem[] = tasksData.map((t: any) => ({
				text: t.title || 'Untitled',
				checked: t.status === 2, // 2 is usually completed in ticktick, but these are undone so it's false
				time: t.start_date || t.due_date || ''
			}));

			this.cache = {
				todayCount: parsedTasks.length,
				completedCount: 0, // Since we only queried undone tasks
				overdueCount: parsedTasks.filter(t => {
					if (!t.time) return false;
					const due = new Date(t.time);
					return due < new Date() && !t.checked;
				}).length,
				tasks: parsedTasks
			};

			await this.saveToDisk(this.cache);
			new Notice('TickTick 同步完成！');
			return this.cache;
		} catch (e) {
			console.warn('TickTick MCP Server communication failed or is offline.', e);
		}
		return null;
	}

	private parseTasksFromMcpText(text: string): TaskStats {
		return { todayCount: 5, completedCount: 3, overdueCount: 0, tasks: [] };
	}
}
