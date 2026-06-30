import { App, TFile } from 'obsidian';
import { McpService } from './McpService';
import VaultOsPlugin from '../main';

export interface TaskItem {
	id: string;
	projectId?: string;
	text: string;
	checked: boolean;
	status?: number;
	time?: string;
	dueDate?: string;
	startDate?: string;
	title?: string;
	createdTime?: string;
	isAllDay?: boolean;
}

export interface CompletedTaskItem {
	id: string;
	projectId?: string;
	title?: string;
	dueDate?: string;
	startDate?: string;
	time?: string;
	completedTime?: string;
	completed_time?: string;
	isAllDay?: boolean;
}

export interface HabitItem {
	id: string;
	name: string;
	totalCheckIns?: number;
}

export interface HabitCheckinItem {
	stamp: number;
	status: number;
}

export interface FocusItem {
	id?: string;
	startTime?: string;
	start_time?: string;
	endTime?: string;
	end_time?: string;
	duration?: number;
	tag?: string;
}

export interface ProjectItem {
	id: string;
	name: string;
}

export interface TaskStats {
	todayCount: number;
	completedCount: number;
	overdueCount: number;
	tasks: TaskItem[];
	completedTasks?: CompletedTaskItem[];
	habits?: HabitItem[];
	habitCheckins?: Record<string, HabitCheckinItem[]>;
	focuses?: FocusItem[];
	projects?: ProjectItem[];
}

export interface TickTickSyncStatus {
	state: 'idle' | 'syncing' | 'success' | 'error';
	lastSyncedAt: number | null;
	errorMessage: string | null;
}

interface CachedTaskData {
	todayCount?: number;
	completedCount?: number;
	overdueCount?: number;
	tasks?: TaskItem[];
	completedTasks?: CompletedTaskItem[];
	habits?: HabitItem[];
	habitCheckins?: Record<string, HabitCheckinItem[]>;
	focuses?: FocusItem[];
	projects?: ProjectItem[];
}




export class TaskService {
	private plugin: VaultOsPlugin;
	private app: App;
	public mcpService: McpService;
	
	// Memory cache for synchronous UI rendering
	private cache: TaskStats = {
		todayCount: 0,
		completedCount: 0,
		overdueCount: 0,
		tasks: []
	};
	private syncStatus: TickTickSyncStatus = {
		state: 'idle',
		lastSyncedAt: null,
		errorMessage: null
	};

	private isInitialized = false;

	constructor(plugin: VaultOsPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.mcpService = new McpService(plugin);
	}

	/**
	 * Returns the instantaneous cached data for 0-latency UI rendering
	 */
	getCache(): TaskStats {
		if (this.syncStatus.state === 'syncing') {
			this.syncStatus = {
				state: 'error',
				lastSyncedAt: this.syncStatus.lastSyncedAt,
				errorMessage: 'TickTick 同步未返回有效数据'
			};
		}
		return this.cache;
	}

	getSyncStatus(): TickTickSyncStatus {
		return this.syncStatus;
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
		const ticktickConfig = this.plugin.settings.ticktickMcp;
		if (!ticktickConfig.enabled || !ticktickConfig.url.trim()) {
			this.syncStatus = {
				state: 'error',
				lastSyncedAt: this.syncStatus.lastSyncedAt,
				errorMessage: !ticktickConfig.enabled ? 'TickTick 连接已关闭' : '未配置 TickTick 接口地址'
			};
			this.cache = {
				todayCount: 0,
				completedCount: 0,
				overdueCount: 0,
				tasks: [
					{ id: 'mock1', text: !ticktickConfig.enabled ? 'TickTick 连接已关闭' : '未配置 TickTick 接口地址', checked: false, time: '' },
					{ id: 'mock2', text: '请前往插件设置补全 TickTick 连接信息', checked: false, time: '' }
				]
			};
			return this.cache;
		}

		this.syncStatus = {
			state: 'syncing',
			lastSyncedAt: this.syncStatus.lastSyncedAt,
			errorMessage: null
		};

		try {
			// 1. Attempt to query the TickTick MCP Server directly
			const mcpStats = await this.fetchFromTickTickMcp();
			if (mcpStats) {
				this.cache = mcpStats;
				await this.saveToDisk(mcpStats);
				this.syncStatus = {
					state: 'success',
					lastSyncedAt: Date.now(),
					errorMessage: null
				};
				return this.cache;
			}
		} catch (error) {
			console.error('Failed to sync tasks from MCP:', error);
			this.syncStatus = {
				state: 'error',
				lastSyncedAt: this.syncStatus.lastSyncedAt,
				errorMessage: error instanceof Error ? error.message : String(error)
			};
		}

		// Fallback mock stats if everything offline/unconfigured
		this.cache = {
			todayCount: 8,
			completedCount: 5,
			overdueCount: 1,
			tasks: [
				{ id: 'mock1', text: '未连接到 TickTick 数据源', checked: false, time: '' },
				{ id: 'mock2', text: '请检查插件内 TickTick 接口地址与请求头', checked: false, time: '' },
				{ id: 'mock3', text: '或缺少本地 ticktick-cache.json 缓存', checked: false, time: '' }
			]
		};
		return this.cache;
	}

	private async loadFromDisk(): Promise<void> {
		try {
			const cachePath = this.plugin.settings.ticktickCachePath;
			const cacheFile = this.app.vault.getAbstractFileByPath(cachePath);
			
			if (cacheFile instanceof TFile) {
				const cacheRaw = await this.app.vault.read(cacheFile);
				const data = JSON.parse(cacheRaw) as CachedTaskData;
				
				this.cache = {
					todayCount: data.todayCount || 0,
					completedCount: data.completedCount || 0,
					overdueCount: data.overdueCount || 0,
					tasks: data.tasks || [],
					completedTasks: data.completedTasks || [],
					habits: data.habits || [],
					habitCheckins: data.habitCheckins || {},
					focuses: data.focuses || [],
					projects: data.projects || []
				};
				this.syncStatus = {
					state: 'success',
					lastSyncedAt: cacheFile.stat.mtime,
					errorMessage: null
				};
			}
		} catch (e) {
			console.warn('No local task cache found or error reading it', e);
		}
	}

	private async saveToDisk(stats: TaskStats): Promise<void> {
		try {
			const cachePath = this.plugin.settings.ticktickCachePath;
			let cacheFile = this.app.vault.getAbstractFileByPath(cachePath);
			const jsonStr = JSON.stringify(stats, null, 2);
			
			if (cacheFile instanceof TFile) {
				await this.app.vault.modify(cacheFile, jsonStr);
			} else {
				// Create the file if it doesn't exist. Ensure folder exists first.
				const lastSlash = cachePath.lastIndexOf('/');
				const folderPath = lastSlash !== -1 ? cachePath.substring(0, lastSlash) : '';
				if (folderPath) {
					const folder = this.app.vault.getAbstractFileByPath(folderPath);
					if (!folder) {
						await this.app.vault.createFolder(folderPath);
					}
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
			const callTool = async (name: string, args: Record<string, unknown> = {}): Promise<unknown[] | null> => {
				const mcpResult = await this.mcpService.executeRequest(this.plugin.settings.ticktickMcp.serviceName, 'tools/call', {
					name,
					arguments: args
				}) as { content?: Array<{ type: string; text: string }>; isError?: boolean };
				
				if (mcpResult.isError) return null;
				if (mcpResult.content && Array.isArray(mcpResult.content)) {
					const results: unknown[] = [];
					for (const block of mcpResult.content) {
						if (block.type === 'text' && block.text) {
							try {
								const parsed = JSON.parse(block.text) as Record<string, unknown> | unknown[];
								if (Array.isArray(parsed)) {
									results.push(...parsed);
								} else if (parsed && typeof parsed === 'object') {
									const parsedObj = parsed as { text?: string; error?: string };
									if (!parsedObj.error) {
										if (typeof parsedObj.text === 'string' && parsedObj.text.startsWith('Error')) {
											console.warn('Vault OS MCP Tool Error:', parsedObj.text);
										} else {
											results.push(parsed);
										}
									}
								}
							} catch (e) {
								console.warn('Vault OS: Failed to parse MCP text result for', name, e);
							}
						}
					}
					return results;
				}
				return null;
			};



			// 1. Fetch all projects
			const projects = (await callTool('list_projects') || []) as ProjectItem[];
			const projectIds = Array.isArray(projects) ? projects.map(p => p.id) : [];
			if (!projectIds.includes('inbox')) projectIds.push('inbox');

			// 2. Fetch all undone tasks for all projects
			let allUndoneTasks: TaskItem[] = [];
			for (const pid of projectIds) {
				const projData = await callTool('get_project_with_undone_tasks', { project_id: pid });
				if (Array.isArray(projData)) {
					for (const p of projData) {
						const proj = p as { tasks?: TaskItem[]; id?: string; title?: string };
						if (proj.tasks && Array.isArray(proj.tasks)) {
							allUndoneTasks = allUndoneTasks.concat(proj.tasks);
						} else if (proj.id && proj.title) {
							allUndoneTasks.push(p as TaskItem);
						}
					}
				}
			}

			// 3. Fetch completed tasks (past 30 days)
			const endDate = new Date(Date.now() + 86400000); // Set to tomorrow to include tasks completed today (due to exclusive boundary)
			const startDate = new Date();
			startDate.setDate(startDate.getDate() - 30);
			const formatDate = (d: Date) => d.toISOString().split('T')[0];
			
			const completedData = (await callTool('list_completed_tasks_by_date', {
				search: {
					start_date: formatDate(startDate),
					end_date: formatDate(endDate),
					timezone: 'Asia/Shanghai'
				}
			}) || []) as CompletedTaskItem[];

			// 4. Fetch habits & habit checkins
			const habitsData = (await callTool('list_habits') || []) as HabitItem[];
			const habitIds = Array.isArray(habitsData) ? habitsData.map((h: HabitItem) => h.id) : [];
			const habitCheckins: Record<string, HabitCheckinItem[]> = {};
			
			if (habitIds.length > 0) {
				const getStamp = (d: Date) => {
					const pad = (num: number) => num.toString().padStart(2, '0');
					return parseInt(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);
				};
				const fromStamp = getStamp(startDate);
				// to_stamp parameter in get_habit_checkins is exclusive, so we must add 1 day to query today's stamp
				const tomorrow = new Date(endDate.getTime() + 86400000);
				const toStamp = getStamp(tomorrow);
				const checkinsRes = await callTool('get_habit_checkins', {
					habit_ids: habitIds,
					from_stamp: fromStamp,
					to_stamp: toStamp
				});
				if (checkinsRes) {
					if (Array.isArray(checkinsRes)) {
						checkinsRes.forEach((item) => {
							const habitCheckin = item as { habitId?: string; id?: string; checkins?: { stamp?: number; checkinStamp?: number; status: number }[] };
							const hId = habitCheckin.habitId || habitCheckin.id;
							if (hId && Array.isArray(habitCheckin.checkins)) {
								habitCheckins[hId] = habitCheckin.checkins.map(c => ({
									stamp: c.stamp || c.checkinStamp || 0,
									status: c.status
								}));
							}
						});
					} else if (typeof checkinsRes === 'object') {
						const record = checkinsRes as Record<string, { stamp?: number; checkinStamp?: number; checkin_stamp?: number; status: number }[]>;
						Object.keys(record).forEach((key: string) => {
							const list = record[key];
							if (Array.isArray(list)) {
								habitCheckins[key] = list.map(c => ({
									stamp: c.stamp || c.checkinStamp || c.checkin_stamp || 0,
									status: c.status
								}));
							}
						});
					}
				}
			}

			// 5. Fetch focuses (using ISO-8601 strings)
			const tzOffset = '+08:00';
			const formatISOWithTZ = (d: Date) => {
				const pad = (num: number) => num.toString().padStart(2, '0');
				const y = d.getFullYear();
				const m = pad(d.getMonth() + 1);
				const date = pad(d.getDate());
				const h = pad(d.getHours());
				const min = pad(d.getMinutes());
				const s = pad(d.getSeconds());
				return `${y}-${m}-${date}T${h}:${min}:${s}${tzOffset}`;
			};

			const focusData0 = (await callTool('get_focuses_by_time', {
				from_time: formatISOWithTZ(startDate),
				to_time: formatISOWithTZ(endDate),
				type: 0
			}) || []) as FocusItem[];
			const focusData1 = (await callTool('get_focuses_by_time', {
				from_time: formatISOWithTZ(startDate),
				to_time: formatISOWithTZ(endDate),
				type: 1
			}) || []) as FocusItem[];
			const focusData = [
				...focusData0,
				...focusData1
			];

			// Process tasks into TaskStats cache object
			const parsedTasks: TaskItem[] = allUndoneTasks.map(t => ({
				...t,
				text: t.title || 'Untitled',
				checked: t.status === 2,
				time: t.startDate || t.dueDate || '',
				isAllDay: t.isAllDay
			}));

			const cacheData: TaskStats = {
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
				habitCheckins: habitCheckins,
				focuses: focusData,
				projects: projects
			};

			this.cache = cacheData;
			await this.saveToDisk(this.cache);
			return this.cache;
		} catch (e) {
			console.warn('TickTick MCP Server communication failed or is offline.', e);
		}
		return null;
	}

	async addTask(title: string, projectId?: string, startDate?: string): Promise<boolean> {
		try {
			const taskObj: Record<string, unknown> = {
				title: title,
				project_id: projectId || 'inbox'
			};
			if (startDate) {
				taskObj.startDate = startDate;
				taskObj.isAllDay = true;
			}
			const mcpResult = await this.mcpService.executeRequest(this.plugin.settings.ticktickMcp.serviceName, 'tools/call', {
				name: 'create_task',
				arguments: {
					task: taskObj
				}
			}) as { isError?: boolean; content?: unknown[] };
			
			if (mcpResult.isError) {
				console.error('Failed to create task:', mcpResult);
				return false;
			}
			
			// Auto trigger sync to get the new task
			await this.syncWithTickTick();
			return true;
		} catch (e) {
			console.error('Error in addTask:', e);
			return false;
		}
	}

	async completeTask(taskObj: TaskItem): Promise<boolean> {
		try {
			const mcpResult = await this.mcpService.executeRequest(this.plugin.settings.ticktickMcp.serviceName, 'tools/call', {
				name: 'update_task',
				arguments: {
					task_id: taskObj.id,
					task: {
						...taskObj,
						status: 2
					}
				}
			}) as { isError?: boolean; content?: unknown[] };
			
			if (mcpResult.isError) {
				console.error('Failed to complete task:', mcpResult);
				return false;
			}
			
			// Update local cache optimistically
			const taskIndex = this.cache.tasks.findIndex(t => t.id === taskObj.id);
			if (taskIndex !== -1) {
				const taskToUpdate = this.cache.tasks[taskIndex];
				if (taskToUpdate) {
					taskToUpdate.checked = true;
					taskToUpdate.status = 2; // TickTick status for completed
				}
			}
			
			await this.saveToDisk(this.cache);
			// Full sync in background
			void this.syncWithTickTick();
			return true;
		} catch (e) {
			console.error('Error in completeTask:', e);
			return false;
		}
	}

	async checkInHabit(habitId: string, stamp: number, isCompleted: boolean): Promise<boolean> {
		try {
			const mcpResult = await this.mcpService.executeRequest(this.plugin.settings.ticktickMcp.serviceName, 'tools/call', {
				name: 'upsert_habit_checkins',
				arguments: {
					habit_id: habitId,
					checkin_data: {
						stamp: stamp,
						status: isCompleted ? 2 : 0 // 2 = completed, 0 = unmarked
					}
				}
			}) as { isError?: boolean; content?: unknown[] };
			
			if (mcpResult.isError) {
				console.error('Failed to check in habit:', mcpResult);
				return false;
			}
			
			// Optimistically update local cache
			if (this.cache.habitCheckins) {
				if (!this.cache.habitCheckins[habitId]) {
					this.cache.habitCheckins[habitId] = [];
				}
				const existingIndex = this.cache.habitCheckins[habitId].findIndex(c => c.stamp === stamp);
				if (existingIndex !== -1) {
					const checkin = this.cache.habitCheckins[habitId][existingIndex];
					if (checkin) {
						checkin.status = isCompleted ? 2 : 0;
					}
				} else {
					this.cache.habitCheckins[habitId].push({ stamp, status: isCompleted ? 2 : 0 });
				}
			}
			
			// Trigger background sync with a 2-second delay to prevent overwriting optimistic cache due to API lag
			window.setTimeout(() => {
				void this.syncWithTickTick();
			}, this.plugin.settings.ticktickSyncDebounce);
			return true;
		} catch (e) {
			console.error('Error in checkInHabit:', e);
			return false;
		}
	}
}
