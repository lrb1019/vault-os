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
			console.log('Agent Dashboard: Starting comprehensive TickTick sync...');
			
			const callTool = async (name: string, args: any = {}) => {
				const mcpResult = await this.mcpService.executeRequest('ticktick', 'tools/call', {
					name,
					arguments: args
				}) as { content?: Array<{ type: string; text: string }>; isError?: boolean };
				
				if (mcpResult.isError) return null;
				if (mcpResult.content && Array.isArray(mcpResult.content)) {
					const textObj = mcpResult.content.find((r: any) => r.type === 'text');
					if (textObj && textObj.text) {
						try {
							return JSON.parse(textObj.text);
						} catch (e) {
							console.warn('Agent Dashboard: Failed to parse MCP text result for', name, e);
						}
					}
				}
				return null;
			};

			// 1. Fetch all projects
			const projects = await callTool('list_projects') || [];
			const projectIds = Array.isArray(projects) ? projects.map(p => p.id) : [];
			if (!projectIds.includes('inbox')) projectIds.push('inbox');

			// 2. Fetch all undone tasks for all projects
			let allUndoneTasks: any[] = [];
			for (const pid of projectIds) {
				const projData = await callTool('get_project_with_undone_tasks', { projectId: pid });
				if (projData && projData.tasks && Array.isArray(projData.tasks)) {
					allUndoneTasks = allUndoneTasks.concat(projData.tasks);
				}
			}

			// 3. Fetch completed tasks (past 30 days)
			const endDate = new Date();
			const startDate = new Date();
			startDate.setDate(startDate.getDate() - 30);
			const formatDate = (d: Date) => d.toISOString().split('T')[0];
			
			const completedData = await callTool('list_completed_tasks_by_date', {
				start_date: formatDate(startDate),
				end_date: formatDate(endDate),
				timezone: 'Asia/Shanghai'
			}) || [];

			// 4. Fetch habits
			const habitsData = await callTool('list_habits') || [];

			// 5. Fetch focuses
			const focusData = await callTool('get_focuses_by_time', {
				startTime: startDate.getTime(),
				endTime: endDate.getTime(),
				type: 0
			}) || [];

			// Process tasks into TaskStats cache object
			// Note: We're expanding TaskStats implicitly here to allow habits/focuses, etc.
			const parsedTasks: any[] = allUndoneTasks.map(t => ({
				...t,
				text: t.title || 'Untitled',
				checked: t.status === 2,
				time: t.start_date || t.due_date || ''
			}));

			const cacheData: any = {
				todayCount: parsedTasks.filter(t => {
					if (!t.time) return false;
					const due = new Date(t.time);
					const today = new Date();
					return due.getDate() === today.getDate() && due.getMonth() === today.getMonth() && due.getFullYear() === today.getFullYear();
				}).length,
				completedCount: Array.isArray(completedData) ? completedData.length : 0,
				overdueCount: parsedTasks.filter(t => {
					if (!t.time) return false;
					const due = new Date(t.time);
					return due < new Date() && !t.checked;
				}).length,
				tasks: parsedTasks,
				completedTasks: completedData,
				habits: habitsData,
				focuses: focusData
			};

			this.cache = cacheData;
			await this.saveToDisk(this.cache);
			new Notice('TickTick 全量同步完成！');
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
