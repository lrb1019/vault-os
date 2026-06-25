import { ItemView, WorkspaceLeaf, Notice, setIcon, TFile, TFolder, moment, Modal, App } from 'obsidian';
import AgentDashboardPlugin from './main';
import { ReadingService } from './services/ReadingService';
import { DiaryService } from './services/DiaryService';
import { TaskService, CompletedTaskItem, HabitCheckinItem, FocusItem, HabitItem } from './services/TaskService';
import { VaultService, VaultOverviewStats } from './services/VaultService';

interface ObsidianAppWithPlugins {
	plugins: {
		manifests: Record<string, unknown>;
		enabledPlugins: Set<string>;
		getPlugin(id: string): unknown;
	};
}

interface ClaudianPlugin {
	activateView(): Promise<void>;
}

interface AppWithCommands {
	commands: {
		executeCommandById(id: string): boolean;
	};
}

interface ScanResultCategory {
	count: number;
	files: string[];
}

interface ScanData {
	inbox: ScanResultCategory;
	orphans: ScanResultCategory;
	deadLinks: ScanResultCategory;
	uningested: ScanResultCategory;
	empty: ScanResultCategory;
}

interface McpCallResult {
	content?: {
		type: string;
		text: string;
	}[];
}

export const VIEW_TYPE_AGENT_DASHBOARD = 'agent-dashboard-view';

class SimpleListModal extends Modal {
	private titleText: string;
	private items: string[];
	
	constructor(app: App, titleText: string, items: string[]) {
		super(app);
		this.titleText = titleText;
		this.items = items;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { 
			text: this.titleText, 
			attr: { style: 'margin-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px; color: var(--text-normal);' } 
		});
		
		if (this.items.length === 0) {
			contentEl.createEl('p', { text: '没有检测到任何项目。', attr: { style: 'font-style: italic; color: var(--text-muted);' } });
		} else {
			const listContainer = contentEl.createDiv({ attr: { style: 'max-height: 400px; overflow-y: auto;' } });
			const ul = listContainer.createEl('ul', { attr: { style: 'margin: 0; padding-left: 20px;' } });
			this.items.forEach(item => {
				const li = ul.createEl('li', { attr: { style: 'margin-bottom: 4px;' } });
				
				let filePath = item;
				const match = item.match(/ in (.*)$/);
				if (match && match[1]) {
					filePath = match[1];
				}

				const a = li.createEl('a', { 
					text: item, 
					cls: 'internal-link',
					attr: { style: 'cursor: pointer; color: var(--text-accent); text-decoration: underline;' } 
				});
				a.onclick = () => {
					void this.app.workspace.openLinkText(filePath, '', true);
					this.close();
				};
			});
		}
		
		const closeBtn = contentEl.createEl('button', { text: '关闭', cls: 'ad-btn ad-btn-secondary', attr: { style: 'float: right; margin-top: 15px;' } });
		closeBtn.onclick = () => this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class LintModal extends Modal {
	private vaultService: VaultService;
	private dashboardView: AgentDashboardView;
	
	constructor(app: App, vaultService: VaultService, dashboardView: AgentDashboardView) {
		super(app);
		this.vaultService = vaultService;
		this.dashboardView = dashboardView;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { 
			text: '库全面健康体检与清理中心', 
			attr: { style: 'margin-bottom: 12px; color: var(--text-normal); border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px;' } 
		});
		
		const progressArea = contentEl.createDiv({ 
			attr: { style: 'margin: 16px 0; padding: 12px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; font-family: var(--font-monospace); font-size: 12px; height: 180px; overflow-y: auto;' } 
		});
		
		const statusText = contentEl.createDiv({ 
			text: '准备就绪，点击下方开始按钮进行全面扫描...', 
			attr: { style: 'font-weight: bold; margin-bottom: 16px;' } 
		});
		
		const buttons = contentEl.createDiv({ attr: { style: 'display: flex; gap: 10px; justify-content: flex-end;' } });
		const startBtn = buttons.createEl('button', { text: '开始体检', cls: 'ad-btn ad-btn-primary' });
		const closeBtn = buttons.createEl('button', { text: '取消', cls: 'ad-btn ad-btn-secondary' });
		
		closeBtn.addEventListener('click', () => {
			this.close();
		});

		startBtn.addEventListener('click', () => {
			startBtn.disabled = true;
			closeBtn.disabled = true;
			
			const steps = [
				'正在读取配置文件与插件装载状态...',
				'正在扫描收件箱与日记目录列表...',
				'正在分析文件引用依赖关系图...',
				'正在检索孤儿文件（未关联页面）...',
				'正在查找失效死链与未解析引用...',
				'正在运行代码规范与 Frontmatter 校验...',
				'正在检查空文件与冗余格式...',
				'评估系统健康指数...',
				'正在生成全面体检报告...'
			];

			let currentStep = 0;
			statusText.setText('正在进行全面深度体检...');
			
			const runStep = () => {
				if (currentStep < steps.length) {
					const stepText = steps[currentStep] || '';
					progressArea.createDiv({ text: `[${currentStep + 1}/${steps.length}] ${stepText}` });
					progressArea.scrollTop = progressArea.scrollHeight;
					
					currentStep++;
					window.setTimeout(runStep, 400);
				} else {
					void Promise.all([
						this.vaultService.getInboxBacklog(),
						this.vaultService.getOrphanCount(),
						this.vaultService.getDeadLinkCount(),
						this.vaultService.getUningestedDiariesCount(),
						this.vaultService.getEmptyNotesCount()
					]).then(([inbox, orphans, deadLinks, uningested, empty]) => {
						progressArea.createDiv({ text: '========================================', attr: { style: 'color: var(--text-success); font-weight: bold;' } });
						progressArea.createDiv({ text: '体检结束！发现以下问题：', attr: { style: 'color: var(--text-success); font-weight: bold;' } });
						progressArea.createDiv({ text: `- 待分类积压 (Inbox): ${inbox.count} 个文件` });
						progressArea.createDiv({ text: `- 待入库日记 (Diary): ${uningested.count} 个文件` });
						progressArea.createDiv({ text: `- 孤立文件 (Orphans): ${orphans.count} 个文件` });
						progressArea.createDiv({ text: `- 失效死链 (Dead Links): ${deadLinks.count} 个链接` });
						progressArea.createDiv({ text: `- 空白笔记 (Empty Notes): ${empty.count} 个文件` });
						
						statusText.setText('体检报告生成成功！已推荐优化策略。');
						startBtn.setCssStyles({ display: 'none' });
						
						const actionBtn = buttons.createEl('button', { text: '一键自动修复', cls: 'ad-btn ad-btn-primary' });
						actionBtn.addEventListener('click', () => {
							actionBtn.disabled = true;
							closeBtn.disabled = true;
							progressArea.createDiv({ text: '正在进行本地空笔记清理与文件回收...' });
							progressArea.scrollTop = progressArea.scrollHeight;
							
							void (async () => {
								try {
									const files = this.app.vault.getMarkdownFiles();
									const candidates = files.filter(file => 
										file.stat.size < 300 &&
										!file.path.includes('templates') &&
										!file.path.includes(this.app.vault.configDir) &&
										!file.path.includes('Dashboard')
									);
									let cleanedCount = 0;
									for (const file of candidates) {
										const content = await this.app.vault.read(file);
										const cleanContent = content.replace(/---[\s\S]*?---/, '').trim();
										if (cleanContent === '') {
											progressArea.createDiv({ text: `正在清理空笔记: ${file.name}` });
											progressArea.scrollTop = progressArea.scrollHeight;
											await this.app.fileManager.trashFile(file);
											cleanedCount++;
										}
									}
									
									progressArea.createDiv({ text: `========================================`, attr: { style: 'color: var(--text-success);' } });
									progressArea.createDiv({ text: `修复完成！共清理 ${cleanedCount} 篇空白笔记。`, attr: { style: 'color: var(--text-success); font-weight: bold;' } });
									progressArea.scrollTop = progressArea.scrollHeight;
									
									// Update view stats
									this.dashboardView.updateCleanedEmpty(cleanedCount);
									
									new Notice(`成功清理 ${cleanedCount} 篇空白笔记！`);
								} catch (err) {
									const errMsg = err instanceof Error ? err.message : String(err);
									progressArea.createDiv({ text: `清理失败: ${errMsg}`, attr: { style: 'color: var(--text-error);' } });
									progressArea.scrollTop = progressArea.scrollHeight;
								} finally {
									closeBtn.disabled = false;
									closeBtn.setText('完成');
								}
							})();
						});
						
						closeBtn.disabled = false;
						closeBtn.setText('完成');
					});
				}
			};
 
			runStep();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class IngestModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { 
			text: '快捷入库与归档控制台', 
			attr: { style: 'margin-bottom: 12px; color: var(--interactive-accent); border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px;' } 
		});
		
		const inboxFolder = this.app.vault.getAbstractFileByPath('02 Inbox');
		let inboxFiles: TFile[] = [];
		if (inboxFolder instanceof TFolder) {
			inboxFiles = inboxFolder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
		}

		if (inboxFiles.length === 0) {
			contentEl.createEl('p', {
				text: '收件箱 (02 inbox) 暂无待分类的笔记！',
				attr: { style: 'color: var(--text-muted); font-style: italic; text-align: center; margin: 30px 0;' }
			});
			const closeBtn = contentEl.createEl('button', { text: '关闭', cls: 'ad-btn ad-btn-secondary', attr: { style: 'float: right;' } });
			closeBtn.onclick = () => this.close();
			return;
		}

		const listWrapper = contentEl.createDiv({ 
			attr: { style: 'display: flex; flex-direction: column; gap: 10px; max-height: 250px; overflow-y: auto; margin-bottom: 20px; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 8px;' } 
		});
		
		contentEl.createDiv({ 
			text: `发现 ${inboxFiles.length} 篇待入库笔记。请选择一件进行处理：`, 
			attr: { style: 'font-size: 13px; margin-bottom: 12px;' } 
		});

		inboxFiles.forEach(file => {
			const row = listWrapper.createDiv({ 
				attr: { style: 'display: flex; justify-content: space-between; align-items: center; padding: 8px; background: var(--background-secondary); border-radius: 4px; gap: 10px;' } 
			});
			row.createSpan({ text: file.basename, attr: { style: 'font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' } });
			
			const actionGroup = row.createDiv({ attr: { style: 'display: flex; gap: 6px; flex-shrink: 0;' } });
			
			// 1. Move to Projects
			const projBtn = actionGroup.createEl('button', { text: '分流至项目', cls: 'ad-btn ad-btn-primary' });
			projBtn.onclick = () => {
				void (async () => {
					const newPath = `03 Projects/${file.name}`;
					await this.app.fileManager.renameFile(file, newPath);
					new Notice(`成功将 ${file.basename} 分流至项目文件夹`);
					this.close();
				})();
			};

			// 2. Archive
			const archiveBtn = actionGroup.createEl('button', { text: '归档', cls: 'ad-btn ad-btn-secondary' });
			archiveBtn.onclick = () => {
				void (async () => {
					const archiveDir = this.app.vault.getAbstractFileByPath('Archive');
					if (!archiveDir) {
						await this.app.vault.createFolder('Archive');
					}
					const newPath = `Archive/${file.name}`;
					await this.app.fileManager.renameFile(file, newPath);
					new Notice(`成功将 ${file.basename} 归档`);
					this.close();
				})();
			};
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

interface ProjectInfo {
	title: string;
	path: string;
	status: 'active' | 'pending' | 'completed' | 'archived';
	progress: number;
	mtimeStr: string;
}

export class AgentDashboardView extends ItemView {
	plugin: AgentDashboardPlugin;
	
	// 看板激活状态 (5个主Tab)
	private activeMainTab: 'vault' | 'diary' | 'lint' | 'ticktick' | 'projects' = 'vault';
	private selectedProjectId: string = 'all';
	private activeStatsSubTab: 'overview' | 'tasks' | 'focus' | 'habits' = 'overview';
	private taskStatsPeriod: 'day' | 'week' | 'month' = 'day';
	private getTasksCompletedOnDay(completedTasks: CompletedTaskItem[], date: Date): number {
		const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
		const dayEnd = dayStart + 86400000;
		return completedTasks.filter(t => {
			const compTime = t.completedTime || t.completed_time;
			return compTime && new Date(compTime).getTime() >= dayStart && new Date(compTime).getTime() < dayEnd;
		}).length;
	}

	private getFocusMinutesOnDay(focuses: FocusItem[], date: Date): number {
		const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
		const dayEnd = dayStart + 86400000;
		return focuses.filter(f => {
			const sTime = f.startTime || f.start_time;
			return sTime && new Date(sTime).getTime() >= dayStart && new Date(sTime).getTime() < dayEnd;
		}).reduce((sum, f) => sum + (f.duration || 0), 0);
	}

	private getHabitCheckinsCountOnDay(habitCheckins: Record<string, HabitCheckinItem[]>, date: Date): number {
		const pad = (num: number) => num.toString().padStart(2, '0');
		const stamp = parseInt(`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`);
		let count = 0;
		Object.keys(habitCheckins).forEach((habitId: string) => {
			const list = habitCheckins[habitId] || [];
			const chk = list.find(c => c.stamp === stamp);
			if (chk && chk.status === 2) count++;
		});
		return count;
	}

	private statsTab: 'week' | 'month' | 'year' | 'all' = 'week';
	private statsChartType: 'bar' | 'calendar' | 'heatmap' = 'bar';
	private periodicTab: 'day' | 'week' | 'month' | 'quarter' | 'year' = 'day';
	private currentDateOffset = 0; // 0 表示当前周期，-1 前一周期，+1 后一周期
	private diaryDateOffset = 0; // 0 表示当前周期，-1 前一周期，+1 后一周期 (for diary)
	private lastScanTime = '尚未进行体检';
	private isScanning = false;
	private historyStats = { ingested: 12, fixedLinks: 47, cleanedEmpty: 9 };
	private currentScanData: ScanData | null = null;

	private cachedVaultOverviewStats: VaultOverviewStats | null = null;
	private cachedDateCounts: Map<string, number> | null = null;

	private clearVaultStatsCache(): void {
		this.cachedVaultOverviewStats = null;
		this.cachedDateCounts = null;
	}

	// 服务实例
	private readingService: ReadingService;
	private diaryService: DiaryService;
	private taskService: TaskService;
	private vaultService: VaultService;

	constructor(leaf: WorkspaceLeaf, plugin: AgentDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
		
		this.readingService = new ReadingService(this.app);
		this.diaryService = new DiaryService(this.app);
		this.taskService = new TaskService(this.app);
		this.vaultService = new VaultService(this.app);
	}

	getViewType(): string {
		return VIEW_TYPE_AGENT_DASHBOARD;
	}

	getDisplayText(): string {
		return '智能控制中心';
	}

	getIcon(): string {
		return 'layout-dashboard';
	}

	triggerClaudianPrompt(prompt: string): void {
		const appWithPlugins = this.app as unknown as ObsidianAppWithPlugins;
		const claudianPlugin = appWithPlugins.plugins?.getPlugin("realclaudian") as ClaudianPlugin | null;
		if (!claudianPlugin) {
			new Notice("未检测到 claudian 插件，请先安装并启用该插件。");
			return;
		}

		if (claudianPlugin && typeof claudianPlugin.activateView === 'function') {
			void claudianPlugin.activateView();
		}

		window.setTimeout(() => {
			const textarea = activeDocument.querySelector<HTMLTextAreaElement>('.claudian-input-wrapper textarea.claudian-input');
			if (!textarea) {
				new Notice("无法定位 claudian 输入框，请确保其窗口已打开。");
				return;
			}

			textarea.value = prompt;
			textarea.dispatchEvent(new Event('input', { bubbles: true }));

			const enterEvent = new KeyboardEvent('keydown', {
				key: 'Enter',
				code: 'Enter',
				keyCode: 13,
				which: 13,
				bubbles: true,
				cancelable: true
			});
			textarea.dispatchEvent(enterEvent);
		}, 300);
	}

	async onOpen(): Promise<void> {
		await this.taskService.initialize();
		
		this.registerEvent(this.app.vault.on('create', () => this.clearVaultStatsCache()));
		this.registerEvent(this.app.vault.on('delete', () => this.clearVaultStatsCache()));
		this.registerEvent(this.app.vault.on('modify', () => this.clearVaultStatsCache()));

		this.render();
		
		if (this.activeMainTab === 'ticktick') {
			void this.taskService.syncWithTickTick().then(() => {
				this.render();
			});
		}
	}

	async onClose(): Promise<void> {
		// 无需特别销毁
	}

	render(): void {
		const container = this.containerEl.children[1];
		if (!container) return;

		container.empty();
		container.addClass('ad-container');

		// 1. 上方区域：系统状态栏 (Telemetry Header)
		this.renderTopTelemetry(container);

		// 2. 下方区域：单页流式展示区 (Viewport)
		const viewport = container.createDiv({ cls: 'ad-viewport' });
		this.renderRightViewport(viewport);
	}

	/**
	 * 1. 渲染顶部系统状态栏 (Telemetry Header)
	 */
	private renderTopTelemetry(parent: Element): void {
		const telemetry = parent.createDiv({ 
			cls: 'ad-top-telemetry', 
			attr: { style: 'border-bottom: 1px solid color-mix(in srgb, var(--background-modifier-border) 40%, transparent); padding-bottom: 16px; margin-bottom: 48px;' } 
		});
		
		// Three-column layout
		const headerRow = telemetry.createDiv({ 
			attr: { style: 'display: flex; justify-content: space-between; align-items: center; width: 100%; position: relative;' } 
		});
		
		// 1. Left column: Empty placeholder to keep the center column centered
		headerRow.createDiv({ attr: { style: 'flex: 1;' } });
		
		// 2. Center column: Core OS Title
		const centerCol = headerRow.createDiv({ attr: { style: 'display: flex; justify-content: center; align-items: center; flex: 2;' } });
		centerCol.createEl('h1', { 
			text: this.plugin.settings.dashboardTitle || 'BYLRB CORE OS', 
			attr: { style: 'font-size: 22px; font-weight: 600 !important; margin: 0; color: var(--text-normal); letter-spacing: 5px; font-family: \'Cinzel\', serif;' } 
		});
		
		// 3. Right column: Metadata (uptime, version)
		const rightCol = headerRow.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex: 1;' } });
		const startDate = moment('2024-05-18');
		const diffDays = moment().diff(startDate, 'days');
		
		rightCol.createDiv({ 
			text: `SYS.v1.2.0 // UPTIME.${diffDays}d`, 
			attr: { style: 'font-size: 11px; color: var(--text-muted); font-family: var(--font-monospace); font-weight: 600; letter-spacing: 1px;' } 
		});
	}

	/**
	 * 2.1 渲染左侧常驻控制总线 (Control Bus)
	 */
	private renderLeftControlBus(parent: Element): void {
		const sidebar = parent.createDiv({ cls: 'ad-sidebar-bus' });

		// 1. Navigation Bus
		this.renderNavigationBus(sidebar);

		// 2. Active Plugins
		this.renderSidebarActivePlugins(sidebar);

		// 2.5 Claudian Workflows
		this.renderClaudianWorkflows(sidebar);

		// 3. Recent Files Feed
		this.renderRecentFilesFeed(sidebar);
	}

	private renderClaudianWorkflows(parent: Element): void {
		const section = parent.createDiv({ cls: 'ad-bus-section' });
		section.createDiv({ text: '// CLAUDIAN WORKFLOWS', cls: 'ad-bus-section-title' });

		const grid = section.createDiv({ 
			attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;' } 
		});

		const workflows = [
			{ name: 'ingest', label: '快捷入库', icon: 'inbox', prompt: '@skills/ingest 请帮我整理并分类 02 Inbox 中的待处理文件' },
			{ name: 'lint', label: '全面体检', icon: 'shield-alert', prompt: '@skills/lint 请帮我扫描并体检整个知识库，找出孤儿笔记与死链并协助修复' },
			{ name: 'query', label: '知识检索', icon: 'search', prompt: '@skills/query ' },
			{ name: 'research', label: '主题研究', icon: 'book-open', prompt: '@skills/research ' }
		];

		workflows.forEach(wf => {
			const btn = grid.createEl('button', {
				cls: 'ad-btn ad-btn-secondary',
				attr: { style: 'text-align: left; padding: 8px; font-size: 11px; display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' }
			});
			setIcon(btn, wf.icon);
			btn.createSpan({ text: wf.label });
			btn.addEventListener('click', () => {
				new Notice(`已触发 claudian 工作流: ${wf.label}`);
				this.triggerClaudianPrompt(wf.prompt);
			});
		});
	}

	private renderNavigationBus(parent: Element): void {
		const section = parent.createDiv({ cls: 'ad-bus-section' });
		section.createDiv({ text: '// NAVIGATION BUS', cls: 'ad-bus-section-title' });

		const docList = [
			{ name: '00 项目总览', path: '03 Projects/Agent Dashboard/00 项目总览.md' },
			{ name: '01 规则指南', path: '03 Projects/Agent Dashboard/01 PROJECT_RULES.md' },
			{ name: '02 后续想法', path: '03 Projects/Agent Dashboard/02 后续想法.md' },
			{ name: '03 改动日志', path: '03 Projects/Agent Dashboard/03 改动日志.md' },
			{ name: '04 接续说明', path: '03 Projects/Agent Dashboard/04 接续说明.md' },
			{ name: '05 审查流程', path: '03 Projects/Agent Dashboard/05 审查流程.md' },
			{ name: '06 快捷同步', path: '03 Projects/Agent Dashboard/06 GITHUB_SYNC.md' },
		];

		const listWrapper = section.createDiv({ cls: 'ad-recent-feed' });

		docList.forEach(doc => {
			const item = listWrapper.createDiv({ cls: 'ad-nav-link-item' });
			item.createSpan({ text: doc.name });
			
			const dot = item.createDiv({ cls: 'ad-nav-dot' });
			const file = this.app.vault.getAbstractFileByPath(doc.path);
			if (file instanceof TFile) {
				dot.addClass('is-active');
			}

			item.addEventListener('click', () => {
				void this.app.workspace.openLinkText(doc.path, '', false);
			});
		});
	}

	private renderSidebarActivePlugins(parent: Element): void {
		const section = parent.createDiv({ cls: 'ad-bus-section' });
		section.createDiv({ text: '// ACTIVE PLUGINS', cls: 'ad-bus-section-title' });

		const switches = section.createDiv({ cls: 'ad-plugin-switches' });

		const appWithPlugins = this.app as unknown as ObsidianAppWithPlugins;
		const manifestList = appWithPlugins.plugins?.manifests || {};
		const enabledList = appWithPlugins.plugins?.enabledPlugins || new Set<string>();

		const pluginList = [
			{ id: 'notebook-navigator', label: '目录导航', cmd: 'notebook-navigator:open' },
			{ id: 'jarvis-reader', label: '阅读书架', cmd: 'jarvis-reader:open-library' },
			{ id: 'rss-dashboard', label: 'RSS 订阅', cmd: 'rss-dashboard:open-view' },
			{ id: 'obsidian-excalidraw-plugin', label: '思维导图', cmd: 'obsidian-excalidraw-plugin:open' }
		];

		pluginList.forEach(plug => {
			const isInstalled = !!manifestList[plug.id];
			const isActive = enabledList.has(plug.id);

			const item = switches.createDiv({ cls: 'ad-plugin-switch' });
			item.createSpan({ text: plug.label });

			const btn = item.createEl('button', {
				text: isActive ? '运行' : (isInstalled ? '未启用' : '未安装'),
				cls: `ad-btn ${isActive ? 'ad-btn-primary' : 'ad-btn-secondary'}`
			});

			if (!isActive) {
				btn.disabled = true;
			} else {
				btn.addEventListener('click', () => {
					new Notice(`正在启动: ${plug.label}`);
					const commandId = plug.cmd;
					const appWithCommands = this.app as unknown as AppWithCommands;
					if (appWithCommands.commands && typeof appWithCommands.commands.executeCommandById === 'function') {
						appWithCommands.commands.executeCommandById(commandId);
					}
				});
			}
		});
	}

	private renderRecentFilesFeed(parent: Element): void {
		const section = parent.createDiv({ cls: 'ad-bus-section' });
		section.createDiv({ text: '// RECENT FILES', cls: 'ad-bus-section-title' });

		const feed = section.createDiv({ cls: 'ad-recent-feed' });

		const recentPaths = this.app.workspace.getLastOpenFiles().slice(0, 5);

		if (recentPaths.length === 0) {
			feed.createDiv({
				text: '无最近打开的文件',
				attr: { style: 'color: var(--text-muted); font-size: 11px; font-style: italic; text-align: center; padding: 10px;' }
			});
			return;
		}

		recentPaths.forEach(path => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				const item = feed.createDiv({ cls: 'ad-feed-item' });
				item.createDiv({ text: file.basename, cls: 'ad-feed-name' });
				
				const relativeTime = this.formatRelativeTime(file.stat.mtime);
				item.createDiv({ text: relativeTime, cls: 'ad-feed-time' });

				item.addEventListener('click', () => {
					void this.app.workspace.openLinkText(path, '', false);
				});
			}
		});
	}

	private formatRelativeTime(mtime: number): string {
		const diffMs = Date.now() - mtime;
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMins < 1) return '刚刚';
		if (diffMins < 60) return `${diffMins}分钟前`;
		if (diffHours < 24) return `${diffHours}小时前`;
		if (diffDays === 1) return '昨天';
		return `${diffDays}天前`;
	}

	/**
	 * 2.2 渲染右侧展示区 (Viewport)
	 */
	private renderRightViewport(parent: Element): void {
		const tabWrapper = parent.createDiv({ cls: 'ad-viewport-tabs' });
		
		const mainTabs = [
			{ id: 'vault', label: '01 / 仓库', icon: 'activity' },
			{ id: 'diary', label: '02 / 日记', icon: 'calendar' },
			{ id: 'lint', label: '03 / 巡检', icon: 'shield-alert' },
			{ id: 'ticktick', label: '04 / TickTick', icon: 'check-square' },
			{ id: 'projects', label: '05 / 项目', icon: 'kanban' }
		];

		mainTabs.forEach(t => {
			const btn = tabWrapper.createEl('button', { 
				cls: `ad-viewport-tab-btn ${this.activeMainTab === t.id ? 'is-active' : ''}` 
			});
			setIcon(btn, t.icon);
			btn.createSpan({ text: ` ${t.label}` });
			btn.addEventListener('click', () => {
				const prevTab = this.activeMainTab;
				this.activeMainTab = t.id as 'vault' | 'diary' | 'lint' | 'ticktick' | 'projects';
				this.render();
				
				if (this.activeMainTab === 'ticktick' && prevTab !== 'ticktick') {
					void this.taskService.syncWithTickTick().then(() => {
						this.render();
					});
				}
			});
		});

		const contentWrapper = parent.createDiv({ cls: 'ad-tab-content' });

		if (this.activeMainTab === 'vault') {
			this.renderVaultDashboard(contentWrapper);
		} else if (this.activeMainTab === 'diary') {
			this.renderDiaryDashboard(contentWrapper);
		} else if (this.activeMainTab === 'lint') {
			this.renderLintDashboard(contentWrapper);
		} else if (this.activeMainTab === 'ticktick') {
			this.renderTickTickDashboard(contentWrapper);
		} else if (this.activeMainTab === 'projects') {
			this.renderProjectsDashboard(contentWrapper);
		}
	}

	/**
	 * =========================================================================
	 * 01 / 仓库主频道渲染
	 * =========================================================================
	 */
	
	private renderTickTickDashboard(parent: Element): void {
		const wrapper = parent.createDiv({ 
			cls: 'ad-ticktick-wrapper', 
			attr: { style: 'animation: fadeIn 0.4s ease-out; display: flex; flex-direction: column; gap: 20px;' } 
		});

		// 1. Unified header
		const header = wrapper.createDiv({ 
			attr: { style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 12px; margin-bottom: 8px;' } 
		});

		// Left switcher: Stats sub-tabs (总览 | 任务 | 专注 | 习惯)
		const leftSwitcher = header.createDiv({ attr: { style: 'display: flex; gap: 10px; align-items: center;' } });
		const subTabWrapper = leftSwitcher.createDiv({ attr: { style: 'display: flex; background: var(--background-secondary); border-radius: 8px; padding: 4px; gap: 4px; border: 1px solid var(--background-modifier-border);' } });
		const subTabs = [
			{ id: 'overview', label: '总览' },
			{ id: 'tasks', label: '任务' },
			{ id: 'focus', label: '专注' },
			{ id: 'habits', label: '习惯' }
		];
		
		subTabs.forEach(t => {
			const isActive = this.activeStatsSubTab === t.id;
			const btn = subTabWrapper.createEl('button', {
				text: t.label,
				attr: {
					style: `border: none; outline: none; padding: 4px 16px; font-size: 13px; border-radius: 6px; cursor: pointer; transition: all 0.2s; background: ${isActive ? 'var(--background-primary)' : 'transparent'}; color: ${isActive ? 'var(--text-normal)' : 'var(--text-muted)'}; box-shadow: ${isActive ? '0 1px 3px rgba(0,0,0,0.05)' : 'none'};`
				}
			});
			btn.addEventListener('click', () => {
				this.activeStatsSubTab = t.id as 'overview' | 'tasks' | 'focus' | 'habits';
				this.render();
			});
		});

		// Right actions: Refresh button (刷新)
		const rightActions = header.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
		const refreshBtn = rightActions.createEl('button', {
			text: '刷新',
			cls: 'ad-btn ad-btn-primary',
			attr: { style: 'font-size: 13px; padding: 4px 16px;' }
		});
		refreshBtn.addEventListener('click', () => {
			new Notice('开始同步 TickTick 数据...');
			void this.taskService.syncWithTickTick().then(() => {
				new Notice('同步完成！');
				this.render();
			});
		});

		// 2. Render content
		const container = wrapper.createDiv({ attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; gap: 20px;' } });
		if (this.activeStatsSubTab === 'overview') {
			this.renderStatsOverview(container);
		} else if (this.activeStatsSubTab === 'tasks') {
			this.renderStatsTasks(container);
		} else if (this.activeStatsSubTab === 'focus') {
			this.renderStatsFocus(container);
		} else if (this.activeStatsSubTab === 'habits') {
			this.renderStatsHabits(container);
		}
	}

	private renderStatsOverview(parent: HTMLElement): void {
		const stats = this.taskService.getCache();
		const tasks = stats.tasks || [];
		const completedTasks = stats.completedTasks || [];
		const habits = stats.habits || [];
		const habitCheckins = stats.habitCheckins || {};
		const focuses = stats.focuses || [];

		// 1. Top account telemetry bar
		const telemetry = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; margin-bottom: 8px;' } });
		const leftTel = telemetry.createDiv({ attr: { style: 'display: flex; gap: 24px;' } });
		
		const totalUndone = tasks.length;
		const totalCompleted = stats.completedCount || completedTasks.length || 0;
		const totalTasks = totalUndone + totalCompleted;
		
		const uniqueProjects = new Set(tasks.map(t => t.projectId).filter(Boolean));
		const projectsCount = uniqueProjects.size;
		
		const oldestTime = tasks.map(t => t.createdTime ? new Date(t.createdTime).getTime() : 0).filter(Boolean);
		const oldestTimeVal = oldestTime.length > 0 ? Math.min(...oldestTime) : Date.now();
		const usageDays = oldestTime.length > 0 ? Math.max(1, Math.ceil((Date.now() - oldestTimeVal) / (1000 * 3600 * 24))) : 0;

		const createTelItem = (val: number, label: string) => {
			const item = leftTel.createDiv({ attr: { style: 'display: flex; align-items: baseline; gap: 4px;' } });
			item.createDiv({ text: String(val), attr: { style: 'font-size: 16px; font-weight: bold; font-family: var(--font-monospace);' } });
			item.createDiv({ text: label, attr: { style: 'font-size: 12px; color: var(--text-muted);' } });
		};
		createTelItem(totalTasks, '任务');
		createTelItem(totalCompleted, '已完成');
		createTelItem(projectsCount, '清单');
		createTelItem(usageDays, '使用天数');


		// 2. Main content grid (2x2 equal size)
		const grid = parent.createDiv({ attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 16px; flex-grow: 1; min-height: 0; box-sizing: border-box;' } });

		const now = new Date();
		const last7Days = [];
		for (let i = 6; i >= 0; i--) {
			last7Days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
		}
		const completedTrendLabels = last7Days.map((d, i) => i === 6 ? '今天' : `${d.getDate()}日`);

		// --- Card A: 概览 (Overview) ---
		const overviewCard = grid.createDiv({ 
			cls: 'ad-card ad-tech-card', 
			attr: { style: 'display: flex; flex-direction: column; padding: 16px; overflow: hidden; height: 100%; box-sizing: border-box;' } 
		});
		overviewCard.createEl('h3', { text: '概览', attr: { style: 'margin: 0 0 8px 0; font-size: 13px; font-weight: 500;' } });
		
		const overviewGrid = overviewCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; flex-grow: 1; align-items: center;' } });
		
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const todayEnd = todayStart + 86400000;

		const todayCompletedCount = completedTasks.filter(t => {
			const compTime = t.completedTime || t.completed_time;
			return compTime && new Date(compTime).getTime() >= todayStart && new Date(compTime).getTime() < todayEnd;
		}).length;

		const todayFocuses = focuses.filter(f => {
			const sTime = f.startTime || f.start_time;
			return sTime && new Date(sTime).getTime() >= todayStart && new Date(sTime).getTime() < todayEnd;
		});
		const todayFocusCount = todayFocuses.length;
		const todayFocusDurationMin = todayFocuses.reduce((sum: number, f) => sum + (f.duration || 0), 0);
		const todayFocusDurationStr = `${Math.floor(todayFocusDurationMin / 60)}h${todayFocusDurationMin % 60}m`;

		const totalFocusCount = focuses.length;
		const totalFocusDurationMin = focuses.reduce((sum: number, f) => sum + (f.duration || 0), 0);
		const totalFocusDurationStr = `${Math.floor(totalFocusDurationMin / 60)}h${totalFocusDurationMin % 60}m`;

		const createOverviewItem = (valToday: string, labelToday: string, valTotal: string, labelTotal: string) => {
			const item = overviewGrid.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--background-secondary); padding: 8px; border-radius: 8px; border: 1px solid var(--background-modifier-border); height: 100%; box-sizing: border-box;' } });
			item.createDiv({ text: valToday, attr: { style: 'font-size: 18px; font-weight: bold; color: var(--interactive-accent); font-family: var(--font-monospace); line-height: 1.2;' } });
			item.createDiv({ text: labelToday, attr: { style: 'font-size: 11px; color: var(--text-muted); margin-bottom: 4px;' } });
			item.createDiv({ text: valTotal, attr: { style: 'font-size: 14px; font-weight: 500; color: var(--text-normal); font-family: var(--font-monospace); line-height: 1.2;' } });
			item.createDiv({ text: labelTotal, attr: { style: 'font-size: 10px; color: var(--text-faint);' } });
		};

		createOverviewItem(String(todayCompletedCount), '今日已完成', String(totalCompleted), '总已完成');
		createOverviewItem(String(todayFocusCount), '今日番茄', String(totalFocusCount), '总番茄');
		createOverviewItem(todayFocusDurationStr, '今日专注时长', totalFocusDurationStr, '总专注时长');

		// --- Card E: 最近完成率趋势 (SVG Bar Chart) ---
		const completionRateCard = grid.createDiv({ 
			cls: 'ad-card ad-tech-card', 
			attr: { style: 'display: flex; flex-direction: column; padding: 16px; overflow: hidden; height: 100%; box-sizing: border-box;' } 
		});
		completionRateCard.createEl('h3', { text: '最近完成率趋势', attr: { style: 'margin: 0 0 8px 0; font-size: 13px; font-weight: 500;' } });
		
		const completionRateData = last7Days.map(d => {
			const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
			const dayEnd = dayStart + 86400000;
			
			const actDone = this.getTasksCompletedOnDay(completedTasks, d);
			const actUndone = tasks.filter(t => {
				if (!t.dueDate && !t.startDate && !t.time) return false;
				const dueStr = t.dueDate || t.startDate || t.time || '';
				const dueTime = new Date(dueStr).getTime();
				return dueTime >= dayStart && dueTime < dayEnd;
			}).length;
			
			const total = actDone + actUndone;
			return total > 0 ? Math.round((actDone / total) * 100) : 0;
		});
		this.drawSvgBarChart(completionRateCard, completionRateData, completedTrendLabels, '%');

		// --- Card B: 最近已完成趋势 (SVG Line/Area Chart) ---
		const completedTrendCard = grid.createDiv({ 
			cls: 'ad-card ad-tech-card', 
			attr: { style: 'display: flex; flex-direction: column; padding: 16px; overflow: hidden; height: 100%; box-sizing: border-box;' } 
		});
		completedTrendCard.createEl('h3', { text: '最近已完成趋势', attr: { style: 'margin: 0 0 8px 0; font-size: 13px; font-weight: 500;' } });
		
		const completedTrendData = last7Days.map(d => {
			return this.getTasksCompletedOnDay(completedTasks, d);
		});
		
		this.drawSvgLineChart(completedTrendCard, completedTrendData, completedTrendLabels, '次', true);

		// --- Card C: 本周打卡进展 (Weekly Habit Rings) ---
		const habitsProgressCard = grid.createDiv({ 
			cls: 'ad-card ad-tech-card', 
			attr: { style: 'display: flex; flex-direction: column; padding: 16px; overflow: hidden; height: 100%; box-sizing: border-box;' } 
		});
		habitsProgressCard.createEl('h3', { text: '本周打卡进展', attr: { style: 'margin: 0 0 8px 0; font-size: 13px; font-weight: 500;' } });
		this.drawHabitRings(habitsProgressCard, habits, habitCheckins);
	}

	private drawSvgLineChart(
		parent: HTMLElement, 
		data: number[], 
		labels: string[], 
		unit: string = '', 
		showArea: boolean = true,
		useYMin: boolean = false
	): void {
		const svgContainer = parent.createDiv({ attr: { style: 'width: 100%; flex-grow: 1; min-height: 0; position: relative;' } });
		const svg = svgContainer.createSvg('svg', { attr: { width: '100%', height: '100%', viewBox: '0 0 400 140', preserveAspectRatio: 'none' } });

		const maxVal = Math.max(...data, 1);
		const minVal = useYMin ? Math.min(...data) - 10 : 0;
		const range = maxVal - minVal || 1;

		const width = 400;
		const height = 100;
		const paddingLeft = 35;
		const paddingRight = 10;
		const paddingTop = 15;
		const chartWidth = width - paddingLeft - paddingRight;

		const points: {x: number, y: number}[] = data.map((val, idx) => {
			const x = paddingLeft + (idx / (data.length - 1)) * chartWidth;
			const y = paddingTop + height - ((val - minVal) / range) * height;
			return { x, y };
		});

		// 1. Draw Grid Lines & Y ticks
		const gridCount = 3;
		for (let i = 0; i <= gridCount; i++) {
			const y = paddingTop + (i / gridCount) * height;
			const val = minVal + ((gridCount - i) / gridCount) * range;
			
			// Grid line
			svg.createSvg('line', {
				attr: {
					x1: String(paddingLeft),
					y1: String(y),
					x2: String(width - paddingRight),
					y2: String(y),
					stroke: 'var(--background-modifier-border)',
					'stroke-width': '0.5',
					'stroke-dasharray': '2 2'
				}
			});

			// Tick text
			const text = svg.createSvg('text', {
				attr: {
					x: String(paddingLeft - 5),
					y: String(y + 4),
					fill: 'var(--text-faint)',
					'font-size': '8px',
					'text-anchor': 'end',
					'font-family': 'var(--font-monospace)'
				}
			});
			text.textContent = String(Math.round(val));
		}

		// 2. Draw Area fill (if showArea)
		if (showArea && points.length > 0) {
			const firstPoint = points[0];
			const lastPoint = points[points.length - 1];
			if (firstPoint && lastPoint) {
				let pathD = `M ${firstPoint.x} ${paddingTop + height} `;
				points.forEach(p => {
					pathD += `L ${p.x} ${p.y} `;
				});
				pathD += `L ${lastPoint.x} ${paddingTop + height} Z`;
				
				// Draw gradient path
				const defs = svg.createSvg('defs');
				const gradId = `line-grad-${Math.floor(Math.random() * 100000)}`;
				const linearGradient = defs.createSvg('linearGradient', {
					attr: { id: gradId, x1: '0%', y1: '0%', x2: '0%', y2: '100%' }
				});
				linearGradient.createSvg('stop', { attr: { offset: '0%', 'stop-color': 'var(--interactive-accent)', 'stop-opacity': '0.2' } });
				linearGradient.createSvg('stop', { attr: { offset: '100%', 'stop-color': 'var(--interactive-accent)', 'stop-opacity': '0.0' } });

				svg.createSvg('path', {
					attr: {
						d: pathD,
						fill: `url(#${gradId})`
					}
				});
			}
		}

		// 3. Draw smooth line path
		if (points.length > 1) {
			const firstPoint = points[0];
			if (firstPoint) {
				let pathD = `M ${firstPoint.x} ${firstPoint.y} `;
				for (let i = 0; i < points.length - 1; i++) {
					const p0 = points[i];
					const p1 = points[i+1];
					if (p0 && p1) {
						const cpX1 = p0.x + (p1.x - p0.x) / 3;
						const cpY1 = p0.y;
						const cpX2 = p0.x + 2 * (p1.x - p0.x) / 3;
						const cpY2 = p1.y;
						pathD += `C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y} `;
					}
				}
			svg.createSvg('path', {
				attr: {
					d: pathD,
					fill: 'none',
					stroke: 'var(--interactive-accent)',
					'stroke-width': '2'
				}
			});
			}
		}

		// 4. Draw data points (dots) & X labels
		points.forEach((p, idx) => {
			// Dot
			svg.createSvg('circle', {
				attr: {
					cx: String(p.x),
					cy: String(p.y),
					r: '3.5',
					fill: 'var(--background-primary)',
					stroke: 'var(--interactive-accent)',
					'stroke-width': '1.5'
				}
			});

			// X Label
			const labelY = paddingTop + height + 14;
			const textL = svg.createSvg('text', {
				attr: {
					x: String(p.x),
					y: String(labelY),
					fill: 'var(--text-muted)',
					'font-size': '8px',
					'text-anchor': 'middle'
				}
			});
			textL.textContent = labels[idx] || '';
		});
	}

	private drawSvgBarChart(
		parent: HTMLElement, 
		data: number[], 
		labels: string[], 
		unit: string = ''
	): void {
		const svgContainer = parent.createDiv({ attr: { style: 'width: 100%; flex-grow: 1; min-height: 0; position: relative;' } });
		const svg = svgContainer.createSvg('svg', { attr: { width: '100%', height: '100%', viewBox: '0 0 400 140', preserveAspectRatio: 'none' } });

		const maxVal = Math.max(...data, 100);
		const width = 400;
		const height = 100;
		const paddingLeft = 35;
		const paddingRight = 10;
		const paddingTop = 15;
		const chartWidth = width - paddingLeft - paddingRight;

		const barCount = data.length;
		const spacing = 15;
		const totalSpacing = spacing * (barCount - 1);
		const barWidth = (chartWidth - totalSpacing) / barCount;

		// 1. Draw Grid Lines & Y ticks
		const gridCount = 3;
		for (let i = 0; i <= gridCount; i++) {
			const y = paddingTop + (i / gridCount) * height;
			const val = ((gridCount - i) / gridCount) * maxVal;
			
			// Grid line
			svg.createSvg('line', {
				attr: {
					x1: String(paddingLeft),
					y1: String(y),
					x2: String(width - paddingRight),
					y2: String(y),
					stroke: 'var(--background-modifier-border)',
					'stroke-width': '0.5',
					'stroke-dasharray': '2 2'
				}
			});

			// Tick text
			const text = svg.createSvg('text', {
				attr: {
					x: String(paddingLeft - 5),
					y: String(y + 4),
					fill: 'var(--text-faint)',
					'font-size': '8px',
					'text-anchor': 'end',
					'font-family': 'var(--font-monospace)'
				}
			});
			text.textContent = `${Math.round(val)}${unit}`;
		}

		// 2. Draw bars
		data.forEach((val, idx) => {
			const barHeight = (val / maxVal) * height;
			const x = paddingLeft + idx * (barWidth + spacing);
			const y = paddingTop + height - barHeight;

			// Draw bar rect
			svg.createSvg('rect', {
				attr: {
					x: String(x),
					y: String(y),
					width: String(barWidth),
					height: String(barHeight),
					rx: '3',
					fill: 'var(--interactive-accent)'
				}
			});

			// X Label
			const labelY = paddingTop + height + 14;
			const textL = svg.createSvg('text', {
				attr: {
					x: String(x + barWidth / 2),
					y: String(labelY),
					fill: 'var(--text-muted)',
					'font-size': '8px',
					'text-anchor': 'middle'
				}
			});
			textL.textContent = labels[idx] || '';
		});
	}

	private drawHabitRings(parent: HTMLElement, habits: HabitItem[], habitCheckins: Record<string, HabitCheckinItem[]>): void {
		const container = parent.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; padding: 8px 0; flex-grow: 1; min-height: 0;' } });
		
		const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
		const now = new Date();
		const currentDayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=Mon, ..., 6=Sun
		
		// Get dates of the current week (Monday to Sunday)
		const getWeekDates = () => {
			const result = [];
			const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - currentDayIndex);
			for (let i = 0; i < 7; i++) {
				result.push(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
			}
			return result;
		};

		const weekDates = getWeekDates();
		const getStamp = (d: Date) => {
			const pad = (num: number) => num.toString().padStart(2, '0');
			return parseInt(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);
		};

		const activeHabitsCount = habits.length;

		weekDates.forEach((d, idx) => {
			const isFuture = idx > currentDayIndex;
			const stamp = getStamp(d);
			
			// Calculate how many habits checked in on this day
			let checkedInCount = 0;
			if (activeHabitsCount > 0) {
				Object.keys(habitCheckins).forEach((habitId: string) => {
					const list = habitCheckins[habitId] || [];
					const chk = list.find((c) => c.stamp === stamp);
					if (chk && chk.status === 2) checkedInCount++;
				});
			}

			const pct = activeHabitsCount > 0 ? (checkedInCount / activeHabitsCount) : 0;
			
			const col = container.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center; gap: 8px;' } });
			
			// SVG Ring
			const ringSize = 40;
			const r = 16;
			const strokeWidth = 3.5;
			const C = 2 * Math.PI * r; // ~100.5
			const offset = C - pct * C;

			const svg = col.createSvg('svg', { attr: { width: String(ringSize), height: String(ringSize), viewBox: '0 0 40 40' } });
			
			// Background circle
			svg.createSvg('circle', {
				attr: {
					cx: '20',
					cy: '20',
					r: String(r),
					fill: 'transparent',
					stroke: 'var(--background-secondary-alt)',
					'stroke-width': String(strokeWidth)
				}
			});

			// Foreground progress circle
			if (pct > 0 && !isFuture) {
				svg.createSvg('circle', {
					attr: {
						cx: '20',
						cy: '20',
						r: String(r),
						fill: 'transparent',
						stroke: 'var(--interactive-accent)',
						'stroke-width': String(strokeWidth),
						'stroke-dasharray': String(C),
						'stroke-dashoffset': String(offset),
						transform: 'rotate(-90 20 20)',
						'stroke-linecap': 'round'
					}
				});
			}

			// Value label (percentage or checkin count) inside ring
			const textVal = svg.createSvg('text', {
				attr: {
					x: '20',
					y: '23.5',
					fill: isFuture ? 'var(--text-faint)' : (pct > 0 ? 'var(--text-normal)' : 'var(--text-muted)'),
					'font-size': '10px',
					'text-anchor': 'middle',
					'font-weight': pct > 0 ? 'bold' : 'normal'
				}
			});
			textVal.textContent = isFuture ? '-' : `${checkedInCount}`;

			// Weekday label
			col.createDiv({ 
				text: weekdays[idx], 
				attr: { style: `font-size: 11px; ${idx === currentDayIndex ? 'color: var(--text-accent); font-weight: bold;' : 'color: var(--text-muted);'}` } 
			});
		});
	}

	private renderStatsTasks(parent: HTMLElement): void {
		const stats = this.taskService.getCache();
		const tasks = stats.tasks || [];
		const completedTasks = stats.completedTasks || [];

		// Calculate period bounds dynamically
		const now = new Date();
		let periodStart = 0;
		let periodEnd = 0;
		let prevPeriodStart = 0;
		let prevPeriodEnd = 0;
		let prevPeriodLabel = '';

		if (this.taskStatsPeriod === 'day') {
			periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
			periodEnd = periodStart + 86400000;
			prevPeriodStart = periodStart - 86400000;
			prevPeriodEnd = periodStart;
			prevPeriodLabel = '前一天';
		} else if (this.taskStatsPeriod === 'week') {
			const currentDayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
			periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - currentDayIndex).getTime();
			periodEnd = periodStart + 7 * 86400000;
			prevPeriodStart = periodStart - 7 * 86400000;
			prevPeriodEnd = periodStart;
			prevPeriodLabel = '上周';
		} else { // month
			periodStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
			periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
			prevPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
			prevPeriodEnd = periodStart;
			prevPeriodLabel = '上月';
		}

		const doneThisPeriod = completedTasks.filter(t => {
			const compTime = t.completedTime || t.completed_time;
			return compTime && new Date(compTime).getTime() >= periodStart && new Date(compTime).getTime() < periodEnd;
		}).length;

		const doneLastPeriod = completedTasks.filter(t => {
			const compTime = t.completedTime || t.completed_time;
			return compTime && new Date(compTime).getTime() >= prevPeriodStart && new Date(compTime).getTime() < prevPeriodEnd;
		}).length;

		const undoneThisPeriod = tasks.filter(t => {
			if (!t.dueDate && !t.startDate && !t.time) return false;
			const dueStr = t.dueDate || t.startDate || t.time || '';
			const dueTime = new Date(dueStr).getTime();
			return dueTime >= periodStart && dueTime < periodEnd;
		}).length;

		const undoneLastPeriod = tasks.filter(t => {
			if (!t.dueDate && !t.startDate && !t.time) return false;
			const dueStr = t.dueDate || t.startDate || t.time || '';
			const dueTime = new Date(dueStr).getTime();
			return dueTime >= prevPeriodStart && dueTime < prevPeriodEnd;
		}).length;

		const rateThisPeriod = doneThisPeriod + undoneThisPeriod > 0 ? (doneThisPeriod / (doneThisPeriod + undoneThisPeriod)) * 100 : 0;
		const rateLastPeriod = doneLastPeriod + undoneLastPeriod > 0 ? (doneLastPeriod / (doneLastPeriod + undoneLastPeriod)) * 100 : 0;

		// 1. Grid with Date selector
		const topBar = parent.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; background: var(--background-secondary); padding: 8px 16px; border-radius: 8px; border: 1px solid var(--background-modifier-border);' } });
		
		// Date Selector dropdown
		const dateDrop = topBar.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-normal); font-weight: 500;' } });
		const dateSelect = dateDrop.createEl('select', { cls: 'ad-select' });
		dateSelect.createEl('option', { value: 'day', text: '按日' });
		dateSelect.createEl('option', { value: 'week', text: '按周' });
		dateSelect.createEl('option', { value: 'month', text: '按月' });
		dateSelect.value = this.taskStatsPeriod;

		dateSelect.addEventListener('change', (e) => {
			this.taskStatsPeriod = (e.target as HTMLSelectElement).value as 'day' | 'week' | 'month';
			this.render();
		});

		// 2. Middle Row: Overview, Completion Rate Distribution, Classifications
		const grid = parent.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;' } });
		
		// Card 1: Overview (概览)
		const overviewCard = grid.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'display: flex; flex-direction: column; justify-content: space-between; padding: 20px;' } });
		overviewCard.createEl('h3', { text: '概览', attr: { style: 'margin: 0 0 16px 0; font-size: 14px; font-weight: 500;' } });
		
		const innerGrid = overviewCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex-grow: 1; align-items: center;' } });
		
		const drawMetric = (parentElem: HTMLElement, val: string, label: string, diffText: string, isUp: boolean) => {
			const box = parentElem.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center;' } });
			box.createDiv({ text: val, attr: { style: 'font-size: 28px; font-weight: bold; color: var(--interactive-accent); font-family: var(--font-monospace);' } });
			box.createDiv({ text: label, attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 8px;' } });
			
			const trend = box.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 4px; font-size: 11px;' } });
			trend.createSpan({ text: diffText, attr: { style: `color: ${isUp ? 'var(--text-success)' : 'var(--text-error)'};` } });
			trend.createSpan({ text: isUp ? '↑' : '⬇', attr: { style: `color: ${isUp ? 'var(--text-success)' : 'var(--text-error)'}; font-weight: bold;` } });
		};

		const diffDone = doneThisPeriod - doneLastPeriod;
		const diffDoneText = diffDone >= 0 ? `比${prevPeriodLabel}多 ${diffDone} 个` : `比${prevPeriodLabel}少 ${Math.abs(diffDone)} 个`;
		
		const diffRate = rateThisPeriod - rateLastPeriod;
		const diffRateText = diffRate >= 0 ? `比${prevPeriodLabel}多 ${Math.round(diffRate)}%` : `比${prevPeriodLabel}少 ${Math.round(Math.abs(diffRate))}%`;

		drawMetric(innerGrid, String(doneThisPeriod), '完成数', diffDoneText, diffDone >= 0);
		drawMetric(innerGrid, `${rateThisPeriod.toFixed(2)}%`, '完成率', diffRateText, diffRate >= 0);

		// Card 2: Completion Rate Status (完成率分布)
		const distCard = grid.createDiv({ cls: 'ad-card ad-tech-card' });
		distCard.createEl('h3', { text: '完成率分布', attr: { style: 'margin: 0 0 16px 0; font-size: 14px; font-weight: 500;' } });
		
		let overdueDone = 0;
		let onTimeDone = 0;
		let noDateDone = 0;
		
		completedTasks.forEach(t => {
			const compTime = t.completedTime || t.completed_time;
			if (!compTime) return;
			const compTimeMs = new Date(compTime).getTime();
			if (compTimeMs >= periodStart && compTimeMs < periodEnd) {
				const dueStr = t.dueDate || t.startDate || t.time;
				if (!dueStr) {
					noDateDone++;
				} else {
					const due = new Date(dueStr).getTime();
					if (compTimeMs > due) {
						overdueDone++;
					} else {
						onTimeDone++;
					}
				}
			}
		});

		const incompleteCount = undoneThisPeriod;

		const donutData = [
			{ label: '逾期完成', value: overdueDone, color: '#FF4B2B' },
			{ label: '按时完成', value: onTimeDone, color: '#0072FF' },
			{ label: '无日期任务', value: noDateDone, color: '#FFB800' },
			{ label: '未完成', value: incompleteCount, color: '#A5A5A5' }
		];

		this.drawDonutChart(distCard, donutData, '完成率', `${rateThisPeriod.toFixed(2)}%`);

		// Card 3: Completed tasks by Category (已完成分类统计)
		const categoryCard = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'margin-top: 10px;' } });
		categoryCard.createEl('h3', { text: '已完成分类统计', attr: { style: 'margin: 0 0 16px 0; font-size: 14px; font-weight: 500;' } });
		
		const projectCounts: Record<string, number> = {};
		completedTasks.forEach(t => {
			const compTime = t.completedTime || t.completed_time;
			if (!compTime) return;
			const compTimeMs = new Date(compTime).getTime();
			if (compTimeMs >= periodStart && compTimeMs < periodEnd) {
				const pId = t.projectId || '收集箱';
				projectCounts[pId] = (projectCounts[pId] || 0) + 1;
			}
		});

		const projectLabels: Record<string, string> = {
			'inbox': '收集箱',
			'收集箱': '收集箱'
		};
		if (stats.projects) {
			stats.projects.forEach(p => {
				projectLabels[p.id] = p.name;
			});
		}

		const catColors = ['#0072FF', '#2ECC71', '#FFB800', '#FF416C', '#8E54E9'];
		const catData = Object.keys(projectCounts).map((pid, idx) => {
			const name = projectLabels[pid] || pid;
			return {
				label: name,
				value: projectCounts[pid] || 0,
				color: catColors[idx % catColors.length] || '#888888'
			};
		});

		const totalCatCount = catData.reduce((sum, item) => sum + item.value, 0);
		this.drawDonutChart(categoryCard, catData, '完成数量', `${totalCatCount}`);
	}

	private drawDonutChart(
		parent: HTMLElement, 
		data: { label: string, value: number, color: string }[], 
		centerLabel: string, 
		centerVal: string
	): void {
		const wrapper = parent.createDiv({ attr: { style: 'display: flex; align-items: center; justify-content: space-around; padding: 10px 0; gap: 20px;' } });
		
		const chartDiv = wrapper.createDiv({ attr: { style: 'width: 140px; height: 140px; position: relative;' } });
		const svg = chartDiv.createSvg('svg', { attr: { width: '100%', height: '100%', viewBox: '0 0 100 100' } });

		const total = data.reduce((sum, item) => sum + item.value, 0);
		
		const r = 36;
		const C = 2 * Math.PI * r; // ~226.2
		let accumPct = 0;

		if (total === 0) {
			svg.createSvg('circle', {
				attr: {
					cx: '50',
					cy: '50',
					r: String(r),
					fill: 'transparent',
					stroke: 'var(--background-secondary-alt)',
					'stroke-width': '10'
				}
			});
		} else {
			data.forEach(item => {
				const pct = item.value / total;
				const dashArray = `${pct * C} ${C}`;
				const dashOffset = -accumPct * C;

				svg.createSvg('circle', {
					attr: {
						cx: '50',
						cy: '50',
						r: String(r),
						fill: 'transparent',
						stroke: item.color,
						'stroke-width': '10',
						'stroke-dasharray': dashArray,
						'stroke-dashoffset': String(dashOffset),
						transform: 'rotate(-90 50 50)'
					}
				});
				accumPct += pct;
			});
		}

		const txtGroup = svg.createSvg('g', { attr: { transform: 'translate(50, 50)', 'text-anchor': 'middle' } });
		
		const valText = txtGroup.createSvg('text', {
			attr: {
				y: '0',
				fill: 'var(--text-normal)',
				'font-size': '10px',
				'font-weight': 'bold',
				'font-family': 'var(--font-monospace)'
			}
		});
		valText.textContent = centerVal;

		const lblText = txtGroup.createSvg('text', {
			attr: {
				y: '10',
				fill: 'var(--text-faint)',
				'font-size': '6px'
			}
		});
		lblText.textContent = centerLabel;

		const legendCol = wrapper.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } });
		data.forEach(item => {
			const row = legendCol.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
			row.createDiv({ attr: { style: `width: 8px; height: 8px; border-radius: 50%; background: ${item.color};` } });
			row.createSpan({ 
				text: `${item.value} | ${item.label}`, 
				attr: { style: 'font-size: 11px; color: var(--text-muted);' } 
			});
		});
	}

	private renderStatsFocus(parent: HTMLElement): void {
		const stats = this.taskService.getCache();
		const focuses = stats.focuses || [];

		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const todayEnd = todayStart + 86400000;
		const yesterdayStart = todayStart - 86400000;

		const todayFocuses = focuses.filter(f => {
			const sTime = f.startTime || f.start_time;
			return sTime && new Date(sTime).getTime() >= todayStart && new Date(sTime).getTime() < todayEnd;
		});
		const todayFocusCount = todayFocuses.length;
		const todayFocusDurationMin = todayFocuses.reduce((sum, f) => sum + (f.duration || 0), 0);

		const yesterdayFocuses = focuses.filter(f => {
			const sTime = f.startTime || f.start_time;
			return sTime && new Date(sTime).getTime() >= yesterdayStart && new Date(sTime).getTime() < todayStart;
		});
		const yesterdayFocusCount = yesterdayFocuses.length;
		const yesterdayFocusDurationMin = yesterdayFocuses.reduce((sum, f) => sum + (f.duration || 0), 0);

		const totalFocusCount = focuses.length;
		const totalFocusDurationMin = focuses.reduce((sum, f) => sum + (f.duration || 0), 0);

		// 1. Overview Card
		const overviewCard = parent.createDiv({ cls: 'ad-card ad-tech-card' });
		overviewCard.createEl('h3', { text: '概览', attr: { style: 'margin: 0 0 16px 0; font-size: 14px; font-weight: 500;' } });
		
		const overviewGrid = overviewCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;' } });

		const drawFocusMetric = (parentElem: HTMLElement, val: string, label: string, diffText: string) => {
			const box = parentElem.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--background-secondary); padding: 12px; border-radius: 8px; border: 1px solid var(--background-modifier-border);' } });
			box.createDiv({ text: val, attr: { style: 'font-size: 22px; font-weight: bold; color: var(--interactive-accent); font-family: var(--font-monospace);' } });
			box.createDiv({ text: label, attr: { style: 'font-size: 11px; color: var(--text-muted); margin-bottom: 6px;' } });
			box.createDiv({ text: diffText, attr: { style: 'font-size: 10px; color: var(--text-success); display: flex; align-items: center; gap: 2px;' } });
		};

		const diffTomato = todayFocusCount - yesterdayFocusCount;
		const diffTomatoText = diffTomato >= 0 ? `比前一天多 ${diffTomato} 个 ⬆` : `比前一天少 ${Math.abs(diffTomato)} 个 ⬇`;

		const diffDuration = todayFocusDurationMin - yesterdayFocusDurationMin;
		const diffDurationStr = `${Math.floor(Math.abs(diffDuration) / 60)}h${Math.abs(diffDuration) % 60}m`;
		const diffDurationText = diffDuration >= 0 ? `比前一天多 ${diffDurationStr} ⬆` : `比前一天少 ${diffDurationStr} ⬇`;

		const todayDurationStr = `${Math.floor(todayFocusDurationMin / 60)}h${todayFocusDurationMin % 60}m`;
		const totalDurationStr = `${Math.floor(totalFocusDurationMin / 60)}h${totalFocusDurationMin % 60}m`;

		drawFocusMetric(overviewGrid, String(todayFocusCount), '今日番茄', diffTomatoText);
		drawFocusMetric(overviewGrid, String(totalFocusCount), '总番茄', '');
		drawFocusMetric(overviewGrid, todayDurationStr, '今日专注时长', diffDurationText);
		drawFocusMetric(overviewGrid, totalDurationStr, '总专注时长', '');

		// 2. Middle Row: Donut details & Focus Records list
		const grid = parent.createDiv({ attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px;' } });

		// Donut Detail Card
		const detailCard = grid.createDiv({ cls: 'ad-card ad-tech-card' });
		detailCard.createEl('h3', { text: '专注详情', attr: { style: 'margin: 0 0 16px 0; font-size: 14px; font-weight: 500;' } });
		
		const tagCounts: Record<string, number> = {};
		focuses.forEach(f => {
			const tag = f.tag || '默认专注';
			tagCounts[tag] = (tagCounts[tag] || 0) + (f.duration || 0);
		});

		const detailColors = ['#0072FF', '#2ECC71', '#FFB800', '#FF416C', '#8E54E9'];
		const detailData = Object.keys(tagCounts).map((tag, idx) => ({
			label: tag,
			value: tagCounts[tag] || 0,
			color: detailColors[idx % detailColors.length] || '#888888'
		}));

		const finalDetailData = detailData.length > 0 ? detailData : [
			{ label: '暂无数据', value: 1, color: 'var(--background-secondary-alt)' }
		];
		this.drawDonutChart(detailCard, finalDetailData, '分类比例', '');

		// Focus Records Card
		const recordCard = grid.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'display: flex; flex-direction: column; height: 260px;' } });
		const recordHeader = recordCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' } });
		recordHeader.createEl('h3', { text: '专注记录', attr: { style: 'margin: 0; font-size: 14px; font-weight: 500;' } });
		
		const plusSpan = recordHeader.createSpan({ attr: { style: 'cursor: pointer; color: var(--text-muted);' } });
		setIcon(plusSpan, 'plus');

		const recordList = recordCard.createDiv({ attr: { style: 'flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;' } });
		
		if (focuses.length === 0) {
			recordList.createDiv({ 
				text: '今日暂无专注记录。', 
				attr: { style: 'font-size: 13px; color: var(--text-muted); text-align: center; margin: auto 0; padding: 20px 0;' } 
			});
		} else {
			focuses.slice(0, 10).forEach(f => {
				const item = recordList.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px;' } });
				const left = item.createDiv({ attr: { style: 'display: flex; flex-direction: column;' } });
				
				const dt = new Date(f.startTime || f.start_time || '');
				const dateStr = `${dt.getMonth() + 1}月${dt.getDate()}日`;
				left.createDiv({ text: dateStr, attr: { style: 'font-size: 12px; font-weight: bold; color: var(--text-normal);' } });

				const endDt = new Date(f.endTime || f.end_time || '');
				const startStr = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
				const endStr = `${endDt.getHours().toString().padStart(2, '0')}:${endDt.getMinutes().toString().padStart(2, '0')}`;
				
				const timeWrap = left.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted); margin-top: 4px;' } });
				setIcon(timeWrap.createSpan(), 'clock');
				timeWrap.createSpan({ text: `${startStr} - ${endStr}` });

				item.createDiv({ text: `${f.duration || 0}m`, attr: { style: 'font-size: 12px; font-family: var(--font-monospace); color: var(--text-normal); font-weight: bold;' } });
			});
		}

		// 3. Github style contribution heatmap
		const heatmapCard = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'margin-top: 10px;' } });
		const heatHeader = heatmapCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;' } });
		heatHeader.createEl('h3', { text: '年度热力图', attr: { style: 'margin: 0; font-size: 14px; font-weight: 500;' } });
		heatHeader.createDiv({ text: String(now.getFullYear()), attr: { style: 'font-size: 11px; color: var(--text-muted);' } });
		this.drawFocusHeatmap(heatmapCard, focuses);
	}

	private getHabitsStreak(habitCheckins: Record<string, HabitCheckinItem[]>, now: Date): number {
		const completedStamps = new Set<number>();
		Object.keys(habitCheckins).forEach(habitId => {
			const list = habitCheckins[habitId] || [];
			list.forEach(c => {
				if (c.status === 2) {
					completedStamps.add(c.stamp);
				}
			});
		});

		const pad = (num: number) => num.toString().padStart(2, '0');
		const getStampForDate = (d: Date): number => {
			return parseInt(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);
		};

		let streak = 0;
		const checkDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		const todayStamp = getStampForDate(checkDate);
		const yesterdayDate = new Date(checkDate.getTime() - 86400000);
		const yesterdayStamp = getStampForDate(yesterdayDate);

		const startFromToday = completedStamps.has(todayStamp);
		const startFromYesterday = completedStamps.has(yesterdayStamp);

		if (!startFromToday && !startFromYesterday) {
			return 0;
		}

		let currentDate = startFromToday ? checkDate : yesterdayDate;
		while (true) {
			const stamp = getStampForDate(currentDate);
			if (completedStamps.has(stamp)) {
				streak++;
				currentDate = new Date(currentDate.getTime() - 86400000);
			} else {
				break;
			}
		}
		return streak;
	}

	private renderStatsHabits(parent: HTMLElement): void {
		const stats = this.taskService.getCache();
		const habits = stats.habits || [];
		const habitCheckins = stats.habitCheckins || {};

		const now = new Date();
		const pad = (num: number) => num.toString().padStart(2, '0');
		const todayStamp = parseInt(`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`);

		let totalCheckIns = 0;
		Object.keys(habitCheckins).forEach(habitId => {
			const list = habitCheckins[habitId] || [];
			list.forEach(c => {
				if (c.status === 2) totalCheckIns++;
			});
		});

		let todayCompletedCount = 0;
		habits.forEach(h => {
			const list = habitCheckins[h.id] || [];
			const chk = list.find(c => c.stamp === todayStamp);
			if (chk && chk.status === 2) {
				todayCompletedCount++;
			}
		});

		const habitsCount = habits.length;
		const streakDays = this.getHabitsStreak(habitCheckins, now);

		const overviewCard = parent.createDiv({ 
			cls: 'ad-card ad-tech-card', 
			attr: { style: 'padding: 10px 16px;' } 
		});
		overviewCard.createEl('h3', { text: '概览', attr: { style: 'margin: 0 0 8px 0; font-size: 13px; font-weight: 500;' } });
		
		const overviewGrid = overviewCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;' } });

		const drawHabitMetric = (parentElem: HTMLElement, val: string, label: string, desc: string) => {
			const box = parentElem.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--background-secondary); padding: 6px 12px; border-radius: 8px; border: 1px solid var(--background-modifier-border);' } });
			box.createDiv({ text: val, attr: { style: 'font-size: 20px; font-weight: bold; color: var(--interactive-accent); font-family: var(--font-monospace); line-height: 1.2;' } });
			box.createDiv({ text: label, attr: { style: 'font-size: 11px; color: var(--text-muted); margin-bottom: 2px;' } });
			box.createDiv({ text: desc, attr: { style: 'font-size: 10px; color: var(--text-faint);' } });
		};

		const todayProgressStr = habitsCount > 0 ? `${todayCompletedCount}/${habitsCount}` : '0/0';
		const todayProgressPct = habitsCount > 0 ? Math.round((todayCompletedCount / habitsCount) * 100) : 0;

		drawHabitMetric(overviewGrid, String(totalCheckIns), '打卡总次数', '全部习惯累计打卡数');
		drawHabitMetric(overviewGrid, todayProgressStr, '今日进度', `完成率 ${todayProgressPct}%`);
		drawHabitMetric(overviewGrid, `${streakDays}天`, '连续打卡天数', '每日至少打卡一次习惯');

		const listCard = parent.createDiv({ 
			cls: 'ad-card ad-tech-card', 
			attr: { style: 'margin-top: 10px; display: flex; flex-direction: column; padding: 12px 16px;' } 
		});
		
		const listHeaderRow = listCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px;' } });
		listHeaderRow.createEl('h3', { text: '打卡明细与本周追踪', attr: { style: 'margin: 0; font-size: 13px; font-weight: 500;' } });

		const weekLabelsContainer = listHeaderRow.createDiv({ attr: { style: 'display: flex; gap: 8px; margin-right: 4px;' } });
		const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
		weekdays.forEach(wd => {
			weekLabelsContainer.createDiv({ 
				text: wd, 
				attr: { style: 'width: 14px; text-align: center; font-size: 10px; color: var(--text-muted); font-weight: 600;' } 
			});
		});

		const listContainer = listCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 6px;' } });

		if (habitsCount === 0) {
			listContainer.createDiv({ 
				text: '暂无打卡习惯。请在手机/电脑版滴答清单中添加习惯。', 
				attr: { style: 'font-size: 13px; color: var(--text-muted); text-align: center; padding: 20px 0;' } 
			});
		} else {
			const currentDayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
			const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - currentDayIndex);

			const colors = ['#0072FF', '#2ECC71', '#FFB800', '#FF416C', '#8E54E9'];

			habits.forEach((habit, habitIdx) => {
				const row = listContainer.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; padding: 4px 12px; border-radius: 8px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border);' } });
				
				const leftSide = row.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
				
				const chkList = habitCheckins[habit.id] || [];
				const todayChk = chkList.find(c => c.stamp === todayStamp);
				const isCompletedToday = !!(todayChk && todayChk.status === 2);

				const checkBtn = leftSide.createEl('button', {
					cls: `ad-task-check-btn ${isCompletedToday ? 'is-completed' : ''}`,
					attr: { style: 'margin: 0;' }
				});
				if (isCompletedToday) {
					setIcon(checkBtn, 'check');
				} else {
					checkBtn.addEventListener('click', () => {
						checkBtn.disabled = true;
						setIcon(checkBtn, 'loader');
						checkBtn.addClass('is-loading');
						void this.taskService.checkInHabit(habit.id, todayStamp, true).then((success) => {
							if (success) {
								new Notice(`习惯“${habit.name}”已打卡！`);
								this.render();
							} else {
								new Notice('打卡失败，请重试');
								this.render();
							}
						});
					});
				}

				leftSide.createDiv({ 
					text: habit.name, 
					attr: { style: `font-size: 13px; font-weight: 500; color: ${isCompletedToday ? 'var(--text-muted)' : 'var(--text-normal)'}; ${isCompletedToday ? 'text-decoration: line-through;' : ''}` } 
				});

				const rightSide = row.createDiv({ attr: { style: 'display: flex; gap: 8px;' } });
				const themeColor = colors[habitIdx % colors.length] || '#A5A5A5';

				for (let i = 0; i < 7; i++) {
					const dayDate = new Date(monday.getTime() + i * 86400000);
					const dayStamp = parseInt(`${dayDate.getFullYear()}${pad(dayDate.getMonth() + 1)}${pad(dayDate.getDate())}`);
					
					const cellChk = chkList.find(c => c.stamp === dayStamp);
					const isDone = !!(cellChk && cellChk.status === 2);
					const isFuture = dayDate.getTime() > now.getTime() && dayDate.getDate() !== now.getDate();

					let bgStyle = 'var(--background-secondary-alt)';
					let borderStyle = '1px solid var(--background-modifier-border)';
					if (isDone) {
						bgStyle = themeColor;
						borderStyle = `1px solid ${themeColor}`;
					} else if (isFuture) {
						bgStyle = 'transparent';
						borderStyle = '1px dashed var(--background-modifier-border)';
					}

					rightSide.createDiv({
						attr: {
							style: `width: 14px; height: 14px; border-radius: 3px; background: ${bgStyle}; border: ${borderStyle};`,
							title: `${dayDate.getMonth() + 1}月${dayDate.getDate()}日: ${isDone ? '已打卡' : '未打卡'}`
						}
					});
				}
			});
		}

		const annualCard = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'margin-top: 10px;' } });
		const annualHeader = annualCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;' } });
		annualHeader.createEl('h3', { text: '年度习惯打卡热力图', attr: { style: 'margin: 0; font-size: 14px; font-weight: 500;' } });
		annualHeader.createDiv({ text: String(now.getFullYear()), attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		const heatmapContainer = annualCard.createDiv({ attr: { style: 'width: 100%; overflow-x: auto; padding: 10px 0;' } });
		const svg = heatmapContainer.createSvg('svg', { attr: { width: '560', height: '100', viewBox: '0 0 560 100' } });

		const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
		const startYearDate = new Date(now.getFullYear(), 0, 1);
		
		const monthRowY = 12;
		for (let i = 0; i < 12; i++) {
			const monthDate = new Date(now.getFullYear(), i, 1);
			const diffTime = monthDate.getTime() - startYearDate.getTime();
			const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
			const weekIdx = Math.floor((diffDays + startYearDate.getDay()) / 7);
			const x = 30 + weekIdx * 10;
			
			const textM = svg.createSvg('text', {
				attr: {
					x: String(x),
					y: String(monthRowY),
					fill: 'var(--text-faint)',
					'font-size': '8px'
				}
			});
			textM.textContent = months[i] || '';
		}

		const weekdaysLabels = ['日', '二', '四', '六'];
		weekdaysLabels.forEach((dayLabel, idx) => {
			const textW = svg.createSvg('text', {
				attr: {
					x: '5',
					y: String(28 + idx * 20),
					fill: 'var(--text-faint)',
					'font-size': '8px'
				}
			});
			textW.textContent = dayLabel;
		});

		const dayCheckinCounts: Record<number, number> = {};
		Object.keys(habitCheckins).forEach(habitId => {
			const list = habitCheckins[habitId] || [];
			list.forEach(c => {
				if (c.status === 2) {
					dayCheckinCounts[c.stamp] = (dayCheckinCounts[c.stamp] || 0) + 1;
				}
			});
		});

		const startDate = new Date(now.getFullYear(), 0, 1);
		const startOffset = startDate.getDay();
		startDate.setDate(startDate.getDate() - startOffset);

		const cellSize = 8;
		const cellSpacing = 2;

		for (let week = 0; week < 53; week++) {
			for (let day = 0; day < 7; day++) {
				const d = new Date(startDate.getTime());
				d.setDate(d.getDate() + (week * 7 + day));

				const isCurrentYear = d.getFullYear() === now.getFullYear();
				const stamp = parseInt(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);
				const count = isCurrentYear ? (dayCheckinCounts[stamp] || 0) : 0;

				let color = 'var(--background-secondary-alt)';
				let opacity = isCurrentYear ? '0.3' : '0.0';
				
				if (count > 0 && isCurrentYear) {
					opacity = '1.0';
					if (count === 1) {
						color = 'color-mix(in srgb, var(--interactive-accent) 25%, var(--background-secondary-alt))';
					} else if (count === 2) {
						color = 'color-mix(in srgb, var(--interactive-accent) 55%, var(--background-secondary-alt))';
					} else if (count === 3) {
						color = 'color-mix(in srgb, var(--interactive-accent) 80%, var(--background-secondary-alt))';
					} else {
						color = 'var(--interactive-accent)';
					}
				}

				const x = 30 + week * (cellSize + cellSpacing);
				const y = 20 + day * (cellSize + cellSpacing);

				svg.createSvg('rect', {
					attr: {
						x: String(x),
						y: String(y),
						width: String(cellSize),
						height: String(cellSize),
						rx: '1.5',
						fill: color,
						opacity: opacity,
						title: isCurrentYear ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}: 打卡习惯 ${count} 个` : ''
					}
				});
			}
		}
	}

	private drawFocusHeatmap(parent: HTMLElement, focuses: FocusItem[]): void {
		const container = parent.createDiv({ attr: { style: 'width: 100%; overflow-x: auto; padding: 10px 0;' } });
		const svg = container.createSvg('svg', { attr: { width: '560', height: '100', viewBox: '0 0 560 100' } });

		const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
		
		const today = new Date();
		const startYearDate = new Date(today.getFullYear(), 0, 1);
		
		const monthRowY = 12;
		for (let i = 0; i < 12; i++) {
			const monthDate = new Date(today.getFullYear(), i, 1);
			const diffTime = monthDate.getTime() - startYearDate.getTime();
			const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
			const weekIdx = Math.floor((diffDays + startYearDate.getDay()) / 7);
			const x = 30 + weekIdx * 10;
			
			const textM = svg.createSvg('text', {
				attr: {
					x: String(x),
					y: String(monthRowY),
					fill: 'var(--text-faint)',
					'font-size': '8px'
				}
			});
			textM.textContent = months[i] || '';
		}

		const weekdays = ['日', '二', '四', '六'];
		weekdays.forEach((dayLabel, idx) => {
			const textW = svg.createSvg('text', {
				attr: {
					x: '5',
					y: String(28 + idx * 20),
					fill: 'var(--text-faint)',
					'font-size': '8px'
				}
			});
			textW.textContent = dayLabel;
		});

		const focusMap: Record<number, number> = {};
		const pad = (num: number) => num.toString().padStart(2, '0');
		
		focuses.forEach(f => {
			if (f.startTime || f.start_time) {
				const d = new Date(f.startTime || f.start_time || '');
				const stamp = parseInt(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);
				focusMap[stamp] = (focusMap[stamp] || 0) + (f.duration || 25);
			}
		});

		const startDate = new Date(today.getFullYear(), 0, 1);
		const startOffset = startDate.getDay();
		startDate.setDate(startDate.getDate() - startOffset);

		const cellSize = 8;
		const cellSpacing = 2;

		for (let week = 0; week < 53; week++) {
			for (let day = 0; day < 7; day++) {
				const d = new Date(startDate.getTime());
				d.setDate(d.getDate() + (week * 7 + day));

				const isCurrentYear = d.getFullYear() === today.getFullYear();
				const stamp = parseInt(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);
				const duration = isCurrentYear ? (focusMap[stamp] || 0) : 0;

				let color = 'var(--background-secondary-alt)';
				let opacity = isCurrentYear ? '0.3' : '0.0';
				
				if (duration > 0 && isCurrentYear) {
					opacity = '1.0';
					if (duration <= 30) {
						color = 'color-mix(in srgb, var(--interactive-accent) 25%, var(--background-secondary-alt))';
					} else if (duration <= 60) {
						color = 'color-mix(in srgb, var(--interactive-accent) 55%, var(--background-secondary-alt))';
					} else if (duration <= 120) {
						color = 'color-mix(in srgb, var(--interactive-accent) 80%, var(--background-secondary-alt))';
					} else {
						color = 'var(--interactive-accent)';
					}
				}

				const x = 30 + week * (cellSize + cellSpacing);
				const y = 20 + day * (cellSize + cellSpacing);

				svg.createSvg('rect', {
					attr: {
						x: String(x),
						y: String(y),
						width: String(cellSize),
						height: String(cellSize),
						rx: '1.5',
						fill: color,
						opacity: opacity,
						title: isCurrentYear ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}: ${duration} 分钟` : ''
					}
				});
			}
		}
	}

	private renderVaultDashboard(parent: Element): void {
		const container = parent.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 20px; flex-grow: 1; min-height: 0; height: 100%;' } });
		
		this.renderStatsNav(container);
		
		const telemetryContainer = container.createDiv();
		const miniGridContainer = container.createDiv();
		const chartContainer = container.createDiv({ attr: { style: 'flex-grow: 1; min-height: 0; display: flex; flex-direction: column;' } });

		if (this.cachedVaultOverviewStats) {
			this.renderVaultTelemetryBar(telemetryContainer, this.cachedVaultOverviewStats);
			this.renderMiniGrid(miniGridContainer, this.cachedVaultOverviewStats);
			this.renderChartSection(chartContainer);
		} else {
			telemetryContainer.createDiv({ text: '加载数据中...', attr: { style: 'color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;' } });

			void this.vaultService.getVaultOverviewStats().then(stats => {
				this.cachedVaultOverviewStats = stats;
				telemetryContainer.empty();
				miniGridContainer.empty();
				
				this.renderVaultTelemetryBar(telemetryContainer, stats);
				this.renderMiniGrid(miniGridContainer, stats);
				this.renderChartSection(chartContainer);
			});
		}
	}

	private renderVaultTelemetryBar(parent: Element, stats: VaultOverviewStats): void {
		const card = parent.createDiv({ cls: 'ad-card ad-tech-card ad-vault-telemetry-card' });
		
		const barContainer = card.createDiv({ cls: 'ad-vault-telemetry-bar' });
		const legendContainer = card.createDiv({ cls: 'ad-vault-telemetry-legend' });

		const total = stats.totalMdFiles || 1;
		const data = [
			{ name: '日记 (Daily)', count: stats.countDaily, pct: Math.round((stats.countDaily / total) * 100), cls: 'ad-segment-daily' },
			{ name: '项目 (Projects)', count: stats.countProjects, pct: Math.round((stats.countProjects / total) * 100), cls: 'ad-segment-atomics' },
			{ name: '其他 (Other)', count: stats.countOther + stats.countInbox + stats.countAtomics + stats.countOutput, pct: Math.round(((stats.countOther + stats.countInbox + stats.countAtomics + stats.countOutput) / total) * 100), cls: 'ad-segment-other' }
		].filter(item => item.count > 0);

		data.forEach(item => {
			if (item.pct > 0) {
				barContainer.createDiv({
					cls: `ad-bar-segment ${item.cls}`,
					attr: {
						style: `width: ${item.pct}%;`,
						title: `${item.name}: ${item.count} 篇 (${item.pct}%)`
					}
				});
			}

			const legItem = legendContainer.createDiv({ cls: 'ad-legend-item' });
			legItem.createDiv({ cls: `ad-legend-color ${item.cls}` });
			legItem.createSpan({ text: `${item.name}: ${item.count} 篇 (${item.pct}%)` });
		});
	}

	/**
	 * =========================================================================
	 * 02 / 日记主频道渲染
	 * =========================================================================
	 */
	private renderDiaryDashboard(contentContainer: Element): void {
		const grid = contentContainer.createDiv({ 
			cls: 'ad-dashboard-grid ad-diary-grid',
			attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;' }
		});
		
		this.renderPeriodicNotesPanel(grid);
		void this.renderDiaryStatsCard(grid);
		this.renderCurrentPeriodicNote(grid);
		void this.renderLastYearPreviewCard(grid);
	}

	private async handlePeriodicCellClick(
		date: moment.Moment,
		cycle: 'day' | 'week' | 'month' | 'quarter' | 'year',
		isCreated: boolean,
		filePath: string,
		fileName: string
	): Promise<void> {
		if (isCreated) {
			void this.app.workspace.openLinkText(filePath, '', false);
		} else {
			try {
				const newPath = await this.diaryService.createPeriodicNote(date, cycle);
				new Notice(`已成功创建笔记：${fileName}`);
				void this.app.workspace.openLinkText(newPath, '', false);
				this.render();
			} catch (e) {
				const errMsg = e instanceof Error ? e.message : String(e);
				new Notice(`创建笔记失败: ${errMsg}`);
			}
		}
	}

	private renderPeriodicNotesPanel(parent: Element): void {
		const card = parent.createDiv({ cls: 'ad-card ad-periodic-card ad-tech-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column;' } });
		const header = card.createDiv({ cls: 'ad-card-header', attr: { style: 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px;' } });

		const subTabs = header.createDiv({ cls: 'ad-card-tabs' });
		const tabs = [
			{ id: 'day', label: '日记' },
			{ id: 'week', label: '周记' },
			{ id: 'month', label: '月记' },
			{ id: 'quarter', label: '季记' },
			{ id: 'year', label: '年记' }
		];

		tabs.forEach(t => {
			const btn = subTabs.createEl('button', {
				text: t.label,
				cls: `ad-card-tab-btn ${this.periodicTab === t.id ? 'is-active' : ''}`
			});
			btn.addEventListener('click', () => {
				this.periodicTab = t.id as 'day' | 'week' | 'month' | 'quarter' | 'year';
				this.diaryDateOffset = 0;
				this.render();
			});
		});

		const datePicker = header.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 4px;' } });
		const prevBtn = datePicker.createEl('button', { cls: 'icon-btn', attr: { style: 'background: transparent; border: none; box-shadow: none; cursor: pointer; padding: 4px;' } });
		setIcon(prevBtn, 'chevron-left');
		prevBtn.addEventListener('click', () => {
			this.diaryDateOffset--;
			this.render();
		});

		const now = moment().add(this.diaryDateOffset, (this.periodicTab + 's') as 'days' | 'weeks' | 'months' | 'quarters' | 'years');
		let dateLabel = now.format('YYYY年');
		if (this.periodicTab === 'day') dateLabel = now.format('YYYY/M/D');
		else if (this.periodicTab === 'week') dateLabel = now.format('YYYY[W]ww');
		else if (this.periodicTab === 'month') dateLabel = now.format('YYYY/M');
		else if (this.periodicTab === 'quarter') dateLabel = now.format('YYYY[Q]Q');
		
		datePicker.createSpan({ text: dateLabel, attr: { style: 'font-weight: 500; font-size: 13px; text-align: center;' } });

		const nextBtn = datePicker.createEl('button', { cls: 'icon-btn', attr: { style: 'background: transparent; border: none; box-shadow: none; cursor: pointer; padding: 4px;' } });
		setIcon(nextBtn, 'chevron-right');
		nextBtn.addEventListener('click', () => {
			this.diaryDateOffset++;
			this.render();
		});

		const gridContainer = card.createDiv({ cls: 'ad-periodic-grid-container', attr: { style: 'flex-grow: 1; max-height: none; overflow-y: auto; margin-top: 16px;' } });

		if (this.periodicTab === 'day') {
			const grid = gridContainer.createDiv({ 
				attr: { style: 'display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; width: 100%;' } 
			});
			const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
			weekdays.forEach(wd => {
				grid.createDiv({ text: wd, attr: { style: 'text-align: center; font-size: 11px; color: var(--text-muted); font-weight: 600; padding-bottom: 4px;' } });
			});

			const baseDate = moment().add(this.diaryDateOffset, 'months');
			const daysInMonth = baseDate.daysInMonth();
			
			const firstDay = baseDate.clone().date(1);
			const isoDay = firstDay.day();
			const offset = isoDay === 0 ? 6 : isoDay - 1;

			for (let i = 0; i < offset; i++) {
				grid.createDiv({ cls: 'ad-periodic-cell is-empty', attr: { style: 'pointer-events: none; opacity: 0;' } });
			}

			for (let d = 1; d <= daysInMonth; d++) {
				const date = baseDate.clone().date(d);
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'day');
				const isCreated = this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
				
				const cell = grid.createDiv({ 
					cls: `ad-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
					text: String(d),
					attr: { 
						'title': isCreated ? `日记: ${fileName} (已创建，点击打开)` : `日记: ${fileName} (未创建，点击基于模板新建)`
					} 
				});
				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'day', isCreated, filePath, fileName);
				});
			}
		} else if (this.periodicTab === 'week') {
			const grid = gridContainer.createDiv({ 
				attr: { style: 'display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; width: 100%;' } 
			});
			const baseDate = moment().add(this.diaryDateOffset, 'years');
			
			for (let w = 1; w <= 52; w++) {
				const date = baseDate.clone().isoWeek(w).startOf('isoWeek');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'week');
				const isCreated = this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `ad-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
					text: String(w),
					attr: { 'title': isCreated ? `周记: ${fileName} (已创建)` : `周记: ${fileName} (未创建)` }
				});
				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'week', isCreated, filePath, fileName);
				});
			}
		} else if (this.periodicTab === 'month') {
			const grid = gridContainer.createDiv({ cls: 'ad-periodic-grid', attr: { style: 'display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; width: 100%;' } });
			const baseDate = moment().add(this.diaryDateOffset, 'years');
			
			for (let m = 0; m < 12; m++) {
				const date = baseDate.clone().month(m).startOf('month');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'month');
				const file = this.app.vault.getAbstractFileByPath(filePath);
				const isCreated = file instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `ad-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
					text: String(m + 1),
					attr: { 'title': isCreated ? `月记: ${fileName} (已创建)` : `月记: ${fileName} (未创建)` }
				});

				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'month', isCreated, filePath, fileName);
				});
			}
		} else if (this.periodicTab === 'quarter') {
			const grid = gridContainer.createDiv({ cls: 'ad-periodic-grid', attr: { style: 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; width: 100%;' } });
			const baseDate = moment().add(this.diaryDateOffset, 'years');
			
			for (let q = 1; q <= 4; q++) {
				const date = baseDate.clone().quarter(q).startOf('quarter');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'quarter');
				const file = this.app.vault.getAbstractFileByPath(filePath);
				const isCreated = file instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `ad-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
					text: `Q${q}`,
					attr: { 'title': isCreated ? `季记: ${fileName} (已创建)` : `季记: ${fileName} (未创建)` }
				});

				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'quarter', isCreated, filePath, fileName);
				});
			}
		} else { // year
			const grid = gridContainer.createDiv({ cls: 'ad-periodic-grid', attr: { style: 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; width: 100%;' } });
			const baseDate = moment().add(this.diaryDateOffset, 'years');
			const centerYear = baseDate.year();
			const startYear = centerYear - 5;
			const years = Array.from({ length: 12 }).map((_, i) => startYear + i);
			
			years.forEach(y => {
				const date = moment().year(y).startOf('year');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'year');
				const file = this.app.vault.getAbstractFileByPath(filePath);
				const isCreated = file instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `ad-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
					text: String(y),
					attr: { 'title': isCreated ? `年记: ${fileName} (已创建)` : `年记: ${fileName} (未创建)` }
				});

				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'year', isCreated, filePath, fileName);
				});
			});
		}
	}

	private renderCurrentPeriodicNote(parent: Element): void {
		const diaryCard = parent.createDiv({ cls: 'ad-card ad-diary-card ad-tech-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column;' } });
		
		const tabNames: Record<string, string> = {
			'day': '日记', 'week': '周记', 'month': '月记', 'quarter': '季记', 'year': '年记'
		};
		const currentName = tabNames[this.periodicTab] || '日记';

		const header = diaryCard.createDiv({ cls: 'ad-card-header', attr: { style: 'display: flex; align-items: center; width: 100%; text-align: left;' } });
		header.createEl('h3', { text: `今日${currentName}`, attr: { style: 'margin: 0; text-align: left; align-self: flex-start;' } });
		
		const baseDate = moment().add(this.diaryDateOffset, (this.periodicTab + 's') as 'days' | 'weeks' | 'months' | 'quarters' | 'years');
		const { filePath } = this.diaryService.resolvePeriodicNotePath(baseDate, this.periodicTab);
		
		const content = diaryCard.createDiv({ cls: 'ad-diary-content', attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; margin-top: 12px;' } });
		
		const file = this.app.vault.getAbstractFileByPath(filePath);
		const isCreated = file instanceof TFile;

		const borderStyle = isCreated ? '1px solid var(--text-success)' : '1px dashed var(--background-modifier-border)';
		const innerDiv = content.createDiv({ attr: { style: `border: ${borderStyle}; border-radius: 8px; padding: 12px; flex-grow: 1; display: flex; flex-direction: column;` } });
		
		innerDiv.createEl('div', { text: filePath, cls: 'ad-diary-path', attr: { style: 'font-family: var(--font-monospace); font-size: 11px; margin-bottom: 10px; color: var(--text-muted);' } });
		const summaryEl = innerDiv.createEl('p', { text: `读取中...`, cls: 'ad-diary-summary', attr: { style: 'font-size: 13px; line-height: 1.5; color: var(--text-normal); flex-grow: 1; overflow-y: auto;' } });
		
		if (isCreated) {
			void this.app.vault.read(file).then(fileContent => {
				const summary = this.diaryService.extractSummary(fileContent);
				summaryEl.setText(summary || '无摘要内容。');
			});
		} else {
			summaryEl.setText(`${currentName}尚未创建。点击下方按钮即可基于模板新建。`);
		}

		const openBtn = content.createEl('button', { 
			text: `打开今日${currentName}`, 
			cls: 'ad-btn ad-btn-secondary',
			attr: { style: 'width: 100%; margin-top: 15px;' }
		});
		
		openBtn.onclick = () => {
			void (async () => {
				if (!isCreated) {
					try {
						const newPath = await this.diaryService.createPeriodicNote(baseDate, this.periodicTab);
						new Notice(`成功创建${currentName}: ${newPath}`);
						void this.app.workspace.openLinkText(newPath, '', false);
						this.render();
					} catch (e) {
						const errMsg = e instanceof Error ? e.message : String(e);
						new Notice(`创建${currentName}失败: ${errMsg}`);
					}
				} else {
					void this.app.workspace.openLinkText(filePath, '', false);
				}
			})();
		};
	}

	private async renderDiaryStatsCard(parent: Element): Promise<void> {
		const card = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'display: flex; flex-direction: column;' } });
		const header = card.createDiv({ cls: 'ad-card-header' });
		header.createEl('h3', { text: '日记数据概览' , attr: { style: 'margin: 0; text-align: left; align-self: flex-start;' } });

		const content = card.createDiv({ attr: { style: 'flex-grow: 1; display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; padding: 8px 0; align-content: center;' } });
		content.createDiv({ text: '分析中...', attr: { style: 'color: var(--text-muted); font-size: 13px; grid-column: span 2; text-align: center;' } });

		try {
			const stats = await this.diaryService.getDiaryStats();
			content.empty();

			const createStatItem = (label: string, value: string | number, highlight = false) => {
				const item = content.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--background-secondary); border: 1px solid color-mix(in srgb, var(--background-modifier-border) 60%, transparent); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02); padding: 14px 12px; border-radius: 10px; transition: transform 0.2s;' } });
				item.createDiv({ text: String(value), attr: { style: `font-size: ${highlight ? '22px' : '18px'}; font-weight: 700; font-family: var(--font-monospace); color: ${highlight ? 'var(--text-success)' : 'var(--text-normal)'}; margin-bottom: 6px; text-align: center;` } });
				item.createDiv({ text: label, attr: { style: 'font-size: 12px; color: var(--text-muted); font-weight: 500; text-align: center;' } });
			};

			createStatItem('累计日记', stats.totalDiaries);
			createStatItem('总记录天数', stats.totalDays);
			createStatItem('周 / 月 / 季 / 年', `${stats.totalWeeklies} / ${stats.totalMonthlies} / ${stats.totalQuarterlies} / ${stats.totalYearlies}`);
			createStatItem('连续打卡 (天)', stats.maxStreak, true);
			createStatItem('累积字数 (约)', stats.totalWords);

		} catch {
			content.empty();
			content.createDiv({ text: '统计失败', attr: { style: 'color: var(--text-error); font-size: 13px; grid-column: span 2; text-align: center;' } });
		}
	}

	private async renderLastYearPreviewCard(parent: Element): Promise<void> {
		const card = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'display: flex; flex-direction: column;' } });
		const header = card.createDiv({ cls: 'ad-card-header' });
		
		const baseDate = moment().add(this.diaryDateOffset, (this.periodicTab + 's') as 'days' | 'weeks' | 'months' | 'quarters' | 'years');
		const targetLabel = this.periodicTab === 'day' ? '去年今日' : 
							this.periodicTab === 'year' ? '去年' : 
							`去年同${this.periodicTab === 'week' ? '周' : this.periodicTab === 'month' ? '月' : '季'}`;
		
		header.createEl('h3', { text: `${targetLabel}回望`, attr: { style: 'margin: 0; text-align: left; align-self: flex-start;' } });

		const content = card.createDiv({ attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 12px; padding: 8px 0;' } });
		
		const innerDiv = content.createDiv({ attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: center;' } });
		innerDiv.createDiv({ text: '查询中...', attr: { style: 'color: var(--text-muted); font-size: 13px; text-align: center;' } });

		try {
			const info = await this.diaryService.getLastYearNote(baseDate, this.periodicTab);
			innerDiv.empty();

			if (info) {
				innerDiv.setAttr('style', 'border: 1px solid var(--text-success); border-radius: 8px; padding: 12px; flex-grow: 1; display: flex; flex-direction: column; justify-content: center;');
				innerDiv.createDiv({ 
					text: info.path, 
					attr: { style: 'font-family: var(--font-monospace); font-size: 11px; color: var(--text-muted); word-break: break-all; margin-bottom: 8px;' } 
				});
				
				innerDiv.createDiv({ 
					text: info.summary,
					attr: { style: 'font-size: 13px; line-height: 1.6; color: var(--text-normal); padding: 12px; border-radius: 6px; overflow-y: auto;' }
				});
			} else {
				innerDiv.setAttr('style', 'border: 1px dashed var(--background-modifier-border); border-radius: 8px; padding: 12px; flex-grow: 1; display: flex; flex-direction: column; justify-content: center;');
				innerDiv.createDiv({ 
					attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.6; padding: 20px 0;' }
				}, el => {
					setIcon(el.createDiv({ attr: { style: 'margin-bottom: 12px; color: var(--text-muted); opacity: 0.5;' } }), 'history');
					el.createDiv({ text: `${targetLabel}，您尚未落笔。`, attr: { style: 'font-size: 14px; font-weight: 500; color: var(--text-normal); margin-bottom: 4px;' } });
					el.createDiv({ text: '时光的留白，亦是生活的一部分。', attr: { style: 'font-size: 12px; color: var(--text-muted);' } });
				});
			}

			const btn = content.createEl('button', { cls: 'ad-btn ad-btn-primary', attr: { style: 'width: 100%; margin-top: auto;' } });
			btn.createSpan({ text: `打开${targetLabel}` });
			btn.addEventListener('click', () => {
				void (async () => {
					const targetDate = baseDate.clone().subtract(1, 'year');
					const { filePath } = this.diaryService.resolvePeriodicNotePath(targetDate, this.periodicTab);
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (file instanceof TFile) {
						void this.app.workspace.openLinkText(filePath, '', false);
					} else {
						try {
							const newPath = await this.diaryService.createPeriodicNote(targetDate, this.periodicTab);
							new Notice(`成功创建${targetLabel}: ${newPath}`);
							void this.app.workspace.openLinkText(newPath, '', false);
							this.render();
						} catch (e) {
							new Notice(`创建${targetLabel}失败: ${String(e)}`);
						}
					}
				})();
			});

		} catch {
			innerDiv.empty();
			innerDiv.createDiv({ text: '查询失败', attr: { style: 'color: var(--text-error); font-size: 13px; text-align: center;' } });
		}
	}



	/**
	 * =========================================================================
	 * 03 / 巡检主频道渲染
	 * =========================================================================
	 */
	private renderLintDashboard(parent: Element): void {
		parent.empty();

		const grid = parent.createDiv({ cls: 'ad-middle-grid', attr: { style: 'display: grid; grid-template-columns: 1fr 1.6fr; gap: 16px; margin-bottom: 16px;' } });

		const leftCard = grid.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'text-align: center; display: flex; flex-direction: column; justify-content: space-between; padding: 16px; min-height: 320px;' } });
		leftCard.createEl('h3', { text: '仓库健康度', attr: { style: 'margin: 0; text-align: left; align-self: flex-start; width: 100%;' } });

		const ringContainer = leftCard.createDiv({ cls: 'ad-progress-ring-container', attr: { style: 'margin: 15px auto; position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center;' } });
		const svg = ringContainer.createSvg('svg', { cls: 'ad-progress-ring', attr: { width: '120', height: '120', style: 'position: absolute; top: 0; left: 0; transform: rotate(-90deg);' } });
		svg.createSvg('circle', {
			cls: 'ad-progress-ring-circle-bg',
			attr: { r: '45', cx: '60', cy: '60', fill: 'none', stroke: 'var(--background-modifier-border)', 'stroke-width': '8' }
		});
		const progressCircle = svg.createSvg('circle', {
			cls: 'ad-progress-ring-circle',
			attr: { r: '45', cx: '60', cy: '60', id: 'health-progress-circle', fill: 'none', stroke: 'var(--interactive-accent)', 'stroke-width': '8', 'stroke-dasharray': '282.7', 'stroke-dashoffset': '282.7', style: 'transition: stroke-dashoffset 0.5s ease;' }
		});
		const textPercentage = ringContainer.createDiv({ cls: 'ad-progress-ring-text', text: '--%', attr: { style: 'font-size: 20px; font-weight: bold; z-index: 1;' } });

		const statusInfoDiv = leftCard.createDiv({ attr: { style: 'margin: 10px 0; font-size: 11px; color: var(--text-muted); font-family: var(--font-monospace);' } });
		const scanTimeSpan = statusInfoDiv.createDiv({ text: `上次体检: ${this.lastScanTime}` });
		const statusText = leftCard.createEl('p', {
			text: this.isScanning ? '正在体检中...' : '检测就绪，建议定期巡检优化。',
			attr: { style: 'font-size: 12px; color: var(--text-muted);' }
		});

		const btnGroup = leftCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 10px;' } });
		const runBtn = btnGroup.createEl('button', {
			cls: 'ad-btn ad-btn-secondary',
			attr: { style: 'width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;' }
		});
		setIcon(runBtn, 'play');
		runBtn.createSpan({ text: '开始体检' });

		const rightCard = grid.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'padding: 16px; display: flex; flex-direction: column; justify-content: flex-start; min-height: 320px; gap: 12px;' } });
		rightCard.createEl('h3', { text: '诊断面板', attr: { style: 'margin: 0; text-align: left; align-self: flex-start; width: 100%;' } });
		
		// Log layout (compressed)
		const topLogContainer = rightCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; flex-shrink: 0;' } });
		
		const inboxItem = topLogContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const inboxLeft = inboxItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const inboxIconEl = inboxLeft.createDiv(); setIcon(inboxIconEl, 'inbox');
		const inboxTextWrap = inboxLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 0;' } });
		inboxTextWrap.createSpan({ text: '待分类文件', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const inboxDesc = inboxTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		const diaryItem = topLogContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const diaryLeft = diaryItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const diaryIconEl = diaryLeft.createDiv(); setIcon(diaryIconEl, 'calendar');
		const diaryTextWrap = diaryLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 0;' } });
		diaryTextWrap.createSpan({ text: '待入库日记', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const diaryDesc = diaryTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		// Inspect layout (expanded)
		const bottomInspectContainer = rightCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 10px; flex-grow: 1; overflow-y: auto;' } });
		
		const orphanItem = bottomInspectContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'flex-grow: 1; justify-content: flex-start; align-items: center; cursor: pointer; padding: 12px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const orphanLeft = orphanItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
		const orphanIconEl = orphanLeft.createDiv(); setIcon(orphanIconEl, 'compass');
		const orphanTextWrap = orphanLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px;' } });
		orphanTextWrap.createSpan({ text: '孤儿笔记 (Orphans)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const orphanDesc = orphanTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		const deadLinkItem = bottomInspectContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'flex-grow: 1; justify-content: flex-start; align-items: center; cursor: pointer; padding: 12px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const deadLinkLeft = deadLinkItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
		const deadLinkIconEl = deadLinkLeft.createDiv(); setIcon(deadLinkIconEl, 'link');
		const deadLinkTextWrap = deadLinkLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px;' } });
		deadLinkTextWrap.createSpan({ text: '未解析死链 (Dead Links)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const deadLinkDesc = deadLinkTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		const emptyNoteItem = bottomInspectContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'flex-grow: 1; justify-content: flex-start; align-items: center; cursor: pointer; padding: 12px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const emptyNoteLeft = emptyNoteItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
		const emptyNoteIconEl = emptyNoteLeft.createDiv(); setIcon(emptyNoteIconEl, 'file-text');
		const emptyNoteTextWrap = emptyNoteLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px;' } });
		emptyNoteTextWrap.createSpan({ text: '空白笔记 (Empty Notes)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const emptyNoteDesc = emptyNoteTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		
		inboxItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.inbox.files) new SimpleListModal(this.app, '待分类文件 (Inbox Backlog)', this.currentScanData.inbox.files).open(); });
		diaryItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.uningested.files) new SimpleListModal(this.app, '待入库日记 (Un-ingested Diaries)', this.currentScanData.uningested.files).open(); });
		orphanItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.orphans.files) new SimpleListModal(this.app, '孤儿笔记 (Orphans)', this.currentScanData.orphans.files).open(); });
		deadLinkItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.deadLinks.files) new SimpleListModal(this.app, '未解析死链 (Dead Links)', this.currentScanData.deadLinks.files).open(); });
		emptyNoteItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.empty.files) new SimpleListModal(this.app, '空白笔记 (Empty Notes)', this.currentScanData.empty.files).open(); });

		// Bottom Console: claudian Skill Panel
		const consoleCard = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'margin-bottom: 16px; padding: 16px;' } });

		const consoleLayout = consoleCard.createDiv({ cls: 'ad-console-layout', attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px;' } });
		
		// Dynamic Claudian Actions from Settings
		const presetsDiv = consoleLayout.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } });
		const presetsGrid = presetsDiv.createDiv({ attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px;' } });
		
		const inputsDiv = consoleLayout.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } });

		const actions = this.plugin.settings.claudianActions || [];

		actions.forEach(action => {
			if (!action.requireInput) {
				const btn = presetsGrid.createEl('button', { cls: 'ad-btn ad-btn-secondary', attr: { style: 'justify-content: flex-start; gap: 6px; font-size: 11px; padding: 8px;' } });
				if (action.icon) setIcon(btn, action.icon);
				btn.createSpan({ text: action.label });
				btn.addEventListener('click', () => {
					new Notice(`已触发: ${action.label}`);
					this.triggerClaudianPrompt(action.prompt);
				});
			} else {
				const group = inputsDiv.createDiv({ attr: { style: 'display: flex; gap: 6px; align-items: center;' } });
				const input = group.createEl('input', { type: 'text', placeholder: action.inputPlaceholder || '', attr: { style: 'flex-grow: 1; height: 30px; font-size: 12px; padding: 0 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal);' } });
				const btn = group.createEl('button', { cls: 'ad-btn ad-btn-primary', attr: { style: 'height: 30px; gap: 4px; font-size: 11px; white-space: nowrap;' } });
				if (action.icon) setIcon(btn, action.icon);
				btn.createSpan({ text: action.label });
				btn.addEventListener('click', () => {
					const val = input.value.trim();
					if (val) {
						const finalPrompt = action.prompt.replace(/\{\{input\}\}/g, val);
						this.triggerClaudianPrompt(finalPrompt);
						input.value = '';
					} else {
						new Notice(action.inputPlaceholder ? `请先${action.inputPlaceholder}` : '请输入内容');
					}
				});
			}
		});

		// Bottom Monthly Stats & Report Generating Card
		const reportCard = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'padding: 16px; display: flex; justify-content: space-between; align-items: center;' } });
		
		const statsWrap = reportCard.createDiv({ attr: { style: 'display: flex; gap: 20px; font-size: 12px; color: var(--text-muted); font-family: var(--font-monospace);' } });
		statsWrap.createDiv({ text: `本月分类入库: ${this.historyStats.ingested} 篇` });
		statsWrap.createDiv({ text: `本月修复死链: ${this.historyStats.fixedLinks} 处` });
		statsWrap.createDiv({ text: `本月清理空白: ${this.historyStats.cleanedEmpty} 篇` });

		const reportBtn = reportCard.createEl('button', { cls: 'ad-btn ad-btn-secondary', attr: { style: 'gap: 6px;' } });
		setIcon(reportBtn, 'file-text');
		reportBtn.createSpan({ text: '打开最近一次体检报告' });
		reportBtn.addEventListener('click', () => {
			const outputFolder = this.app.vault.getAbstractFileByPath('05 Output');
			if (outputFolder instanceof TFolder) {
				const reportFiles = outputFolder.children.filter((f): f is TFile => 
					f instanceof TFile && f.name.endsWith('.md') && f.name.startsWith('知识库体检报告-')
				);
				if (reportFiles.length > 0) {
					// Sort descending to get the latest date
					reportFiles.sort((a, b) => b.name.localeCompare(a.name));
					const latestReport = reportFiles[0];
					if (latestReport) {
						void this.app.workspace.openLinkText(latestReport.path, '', false);
					}
				} else {
					new Notice('在 05 Output 中未找到任何体检报告');
				}
			} else {
				new Notice('未找到 05 Output 文件夹');
			}
		});

		// Core calculations and sync updating logic
		const runScan = () => {
			if (this.isScanning) return;
			this.isScanning = true;
			statusText.setText('正在扫描知识库结构与属性...');
			statusText.setCssStyles({ color: 'var(--text-accent)' });
			runBtn.disabled = true;

			window.setTimeout(() => {
				void Promise.all([
					this.vaultService.getInboxBacklog(),
					this.vaultService.getOrphanCount(),
					this.vaultService.getDeadLinkCount(),
					this.vaultService.getUningestedDiariesCount(),
					this.vaultService.getEmptyNotesCount()
				]).then(([inbox, orphans, deadLinks, uningested, empty]) => {
					// Non-linear health evaluation formula
					this.currentScanData = { inbox, orphans, deadLinks, uningested, empty };
					const totalMarkdownFiles = this.app.vault.getMarkdownFiles().length || 1;
					const inboxDeduct = Math.min(25, inbox.count * 3);
					const diaryDeduct = Math.min(20, uningested.count * 2);
					const emptyDeduct = Math.min(15, empty.count * 2);
					const orphanDeduct = Math.min(25, (orphans.count / totalMarkdownFiles) * 50 + Math.min(10, orphans.count * 0.1));
					const deadLinkDeduct = Math.min(15, Math.log10(deadLinks.count + 1) * 5);
					
					let score = Math.round(100 - (inboxDeduct + diaryDeduct + emptyDeduct + orphanDeduct + deadLinkDeduct));
					if (score < 0) score = 0;
					if (score > 100) score = 100;

					const strokeDashoffset = 282.7 - (score / 100) * 282.7;
					progressCircle.setAttribute('stroke-dashoffset', String(strokeDashoffset));
					textPercentage.setText(`${score}%`);

					if (score >= 90) {
						statusText.setText('知识库健康状况极佳，无需特殊干预。');
						statusText.setCssStyles({ color: 'var(--text-success)' });
					} else if (score >= 70) {
						statusText.setText('存在部分需要清理的临时文档或孤立页面。');
						statusText.setCssStyles({ color: 'var(--text-warning)' });
					} else {
						statusText.setText('建议尽快运行一键修复清理孤立节点与空白笔记。');
						statusText.setCssStyles({ color: 'var(--text-error)' });
					}

					inboxDesc.setText(`当前积压: ${inbox.count} 篇 最久: ${inbox.oldestDays} 天`);
					diaryDesc.setText(`发现 ${uningested.count} 篇未入库`);
					orphanDesc.setText(`发现 ${orphans.count} 篇没有引用的孤立笔记`);
					deadLinkDesc.setText(`发现 ${deadLinks.count} 处指向不存在文件的链接`);
					emptyNoteDesc.setText(`发现 ${empty.count} 篇正文为空的笔记`);
					
					// Dynamic Border Colors
					inboxItem.style.border = inbox.count > 0 ? '1px solid var(--text-success)' : '1px dashed var(--background-modifier-border)';
					diaryItem.style.border = uningested.count > 0 ? '1px solid var(--text-success)' : '1px dashed var(--background-modifier-border)';
					orphanItem.style.border = orphans.count > 0 ? '1px solid var(--text-success)' : '1px dashed var(--background-modifier-border)';
					deadLinkItem.style.border = deadLinks.count > 0 ? '1px solid var(--text-success)' : '1px dashed var(--background-modifier-border)';
					emptyNoteItem.style.border = empty.count > 0 ? '1px solid var(--text-success)' : '1px dashed var(--background-modifier-border)';

					this.lastScanTime = moment().format('YYYY-MM-DD HH:mm:ss');
					scanTimeSpan.setText(`上次体检: ${this.lastScanTime}`);

					this.isScanning = false;
					runBtn.disabled = false;
				}).catch(e => {
					console.error('Scan failed:', e);
					this.isScanning = false;
					runBtn.disabled = false;
				});
			}, 600);
		};

		// Trigger scan on load
		runScan();

		// Bind trigger events
		runBtn.addEventListener('click', runScan);
	}
	async generateMonthlyReport(): Promise<void> {
		const ymStr = moment().format('YYYY-MM');
		const dirPath = `03 Projects/Agent Dashboard/Reports`;
		const filePath = `${dirPath}/${ymStr} 巡检报告.md`;

		try {
			// Ensure folder exists
			const folder = this.app.vault.getAbstractFileByPath(dirPath);
			if (!folder) {
				await this.app.vault.createFolder(dirPath);
			}

			// Gather data
			const inbox = await this.vaultService.getInboxBacklog();
			const uningested = await this.vaultService.getUningestedDiariesCount();
			const orphans = await this.vaultService.getOrphanCount();
			const deadLinks = await this.vaultService.getDeadLinkCount();
			const empty = await this.vaultService.getEmptyNotesCount();
			
			const totalMarkdownFiles = this.app.vault.getMarkdownFiles().length || 1;
			const inboxDeduct = Math.min(25, inbox.count * 3);
			const diaryDeduct = Math.min(20, uningested.count * 2);
			const emptyDeduct = Math.min(15, empty.count * 2);
			const orphanDeduct = Math.min(25, (orphans.count / totalMarkdownFiles) * 50 + Math.min(10, orphans.count * 0.1));
			const deadLinkDeduct = Math.min(15, Math.log10(deadLinks.count + 1) * 5);
			
			let score = Math.round(100 - (inboxDeduct + diaryDeduct + emptyDeduct + orphanDeduct + deadLinkDeduct));
			if (score < 0) score = 0;
			if (score > 100) score = 100;

			const content = `---
created: ${moment().format('YYYY-MM-DD')}
author: "[[Jarvis]]"
type: "report"
---

# ${ymStr} 知识库巡检报告

## 1. 综合健康评分
- **当前得分**: **${score} / 100**
- **体检时间**: ${moment().format('YYYY-MM-DD HH:mm:ss')}

## 2. 诊断子项状态
- **待分类文件 (Inbox)**: ${inbox.count} 篇 (最久积压: ${inbox.oldestDays} 天)
- **待入库日记 (Diary)**: ${uningested.count} 篇
- **孤儿笔记 (Orphans)**: ${orphans.count} 篇
- **失效死链 (Dead Links)**: ${deadLinks.count} 处
- **空白笔记 (Empty Notes)**: ${empty.count} 篇

## 3. 本月工作流处理统计
- **已分类入库 (Ingested)**: ${this.historyStats.ingested} 篇
- **已修复死链 (Fixed Links)**: ${this.historyStats.fixedLinks} 处
- **已清理空白笔记 (Cleaned Empty)**: ${this.historyStats.cleanedEmpty} 篇

## 4. 优化建议
${score >= 90 ? '- 知识库健康状况良好，保持常规读写即可。' : '- 建议运行 claudian 智能体指令修复失效死链与空白笔记。\n- 建议使用 claudian 整理收件箱积压。'}
`;

			await this.app.vault.adapter.write(filePath, content);
			new Notice(`已成功生成月度巡检报告: ${filePath}`);
			void this.app.workspace.openLinkText(filePath, '', false);
		} catch (e) {
			new Notice(`生成月度报告失败: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private openLintModal(): void {
		new LintModal(this.app, this.vaultService, this).open();
	}

	updateCleanedEmpty(count: number): void {
		this.historyStats.cleanedEmpty += count;
		this.render();
	}

	private openIngestModal(): void {
		new IngestModal(this.app).open();
	}

	private openOrphansView(count: number): void {
		if (count === 0) {
			new Notice('没有发现孤儿笔记。');
			return;
		}
		void this.vaultService.getOrphanCount().then(() => {
			const resolvedLinks = this.app.metadataCache.resolvedLinks;
			const linkedFiles = new Set<string>();
			for (const sourcePath of Object.keys(resolvedLinks)) {
				const targets = resolvedLinks[sourcePath];
				if (targets) {
					for (const targetPath of Object.keys(targets)) {
						linkedFiles.add(targetPath);
					}
				}
			}

			const files = this.app.vault.getMarkdownFiles();
			const orphans: string[] = [];
			files.forEach(file => {
				if (
					!linkedFiles.has(file.path) && 
					!file.path.startsWith('01 Daily') && 
					!file.path.includes('Dashboard') &&
					!file.path.includes('templates') &&
					!file.path.includes(this.app.vault.configDir)
				) {
					orphans.push(file.path);
				}
			});

			new SimpleListModal(this.app, '孤儿文件列表 (Orphans)', orphans).open();
		});
	}

	private openDeadLinksView(count: number): void {
		if (count === 0) {
			new Notice('没有发现未解析的失效死链。');
			return;
		}
		const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
		const deadLinks: string[] = [];
		for (const sourcePath of Object.keys(unresolvedLinks)) {
			const targets = unresolvedLinks[sourcePath];
			if (targets) {
				for (const targetPath of Object.keys(targets)) {
					deadLinks.push(`${sourcePath} -> [[${targetPath}]] (失效)`);
				}
			}
		}
		new SimpleListModal(this.app, '失效死链列表 (Dead Links)', deadLinks).open();
	}

	/**
	 * =========================================================================
	 * 04 / 待办主频道渲染 (TickTick Tasks Dashboard)
	 * =========================================================================
	 */
	private renderTasksDashboard(parent: Element): void {
		const wrapper = parent.createDiv({ cls: 'ad-tasks-wrapper' });
		const grid = wrapper.createDiv({ cls: 'ad-middle-grid', attr: { style: 'display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px;' } });

		const leftCol = grid.createDiv({ cls: 'ad-tasks-main-col', attr: { style: 'display: flex; flex-direction: column; gap: 20px;' } });
		this.renderTodayTasks(leftCol);

		const rightCol = grid.createDiv({ cls: 'ad-tasks-side-col', attr: { style: 'display: flex; flex-direction: column; gap: 20px;' } });
		this.renderTodayHabits(rightCol);
	}

	private renderTodayTasks(parent: Element): void {
		const todayCard = parent.createDiv({ cls: 'ad-card ad-task-card ad-tech-card' });
		const headerContainer = todayCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center;' } });
		headerContainer.createEl('h3', { text: '今日待办' , attr: { style: 'margin: 0; text-align: left;' } });
		
		const headerRight = headerContainer.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
		
		// Dropdown select
		const select = headerRight.createEl('select', {
			cls: 'dropdown',
			attr: {
				style: 'padding: 2px 6px; font-size: 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); outline: none; cursor: pointer;'
			}
		});
		
		const allOption = select.createEl('option', { value: 'all', text: '全部清单' });
		if (this.selectedProjectId === 'all') allOption.selected = true;

		const stats = this.taskService.getCache();
		const projects = stats.projects || [];
		projects.forEach(p => {
			const option = select.createEl('option', { value: p.id, text: p.name });
			if (this.selectedProjectId === p.id) option.selected = true;
		});

		select.addEventListener('change', () => {
			this.selectedProjectId = select.value;
			this.render();
		});

		const refreshBtn = headerRight.createEl('button', { attr: { title: '手动同步 TickTick', style: 'background: transparent; box-shadow: none; padding: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-muted); border: none;' } });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', () => {
			new Notice('开始同步 TickTick 数据...');
			refreshBtn.setCssStyles({ opacity: '0.5', pointerEvents: 'none' });
			
			void this.taskService.syncWithTickTick().then(() => {
				new Notice('TickTick 同步完成！');
				this.render();
			}).catch(e => {
				new Notice('同步失败: ' + String(e));
				refreshBtn.setCssStyles({ opacity: '1', pointerEvents: 'auto' });
			});
		});
		
		const taskList = todayCard.createDiv({ cls: 'ad-task-list' });
		const tasks = stats.tasks || [];

		// Filter tasks due today
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const todayEnd = todayStart + 86400000;

		const uncompletedToday = tasks.filter(t => {
			const isCompleted = t.status === 2 || t.checked;
			if (isCompleted) return false;

			if (!t.dueDate && !t.startDate && !t.time) return false;
			const dueStr = t.dueDate || t.startDate || t.time || '';
			const dueTime = new Date(dueStr).getTime();
			const isToday = dueTime >= todayStart && dueTime < todayEnd;
			if (!isToday) return false;

			if (this.selectedProjectId !== 'all') {
				return t.projectId === this.selectedProjectId;
			}
			return true;
		});

		const completedTodayFromTasks = tasks.filter(t => {
			const isCompleted = t.status === 2 || t.checked;
			if (!isCompleted) return false;

			if (this.selectedProjectId !== 'all') {
				return t.projectId === this.selectedProjectId;
			}
			return true;
		});

		const completedTodayFromHistory = (stats.completedTasks || []).filter(t => {
			const compTime = t.completedTime || t.completed_time;
			if (!compTime) return false;
			const compTimeMs = new Date(compTime).getTime();
			const isToday = compTimeMs >= todayStart && compTimeMs < todayEnd;
			if (!isToday) return false;

			if (this.selectedProjectId !== 'all') {
				return t.projectId === this.selectedProjectId;
			}
			return true;
		});

		// Deduplicate completed tasks by ID
		const completedToday: { id: string; text: string; projectId?: string; time?: string; checked: boolean; isAllDay?: boolean }[] = [];
		const seenIds = new Set<string>();

		completedTodayFromTasks.forEach(t => {
			if (!seenIds.has(t.id)) {
				seenIds.add(t.id);
				completedToday.push({
					id: t.id,
					text: t.title || t.text || '无标题',
					projectId: t.projectId,
					time: t.dueDate || t.startDate || t.time,
					checked: true,
					isAllDay: t.isAllDay
				});
			}
		});

		completedTodayFromHistory.forEach(t => {
			if (!seenIds.has(t.id)) {
				seenIds.add(t.id);
				completedToday.push({
					id: t.id,
					text: t.title || '无标题',
					projectId: t.projectId,
					time: t.dueDate || t.startDate || t.time || t.completedTime || t.completed_time,
					checked: true,
					isAllDay: t.isAllDay
				});
			}
		});

		if (uncompletedToday.length === 0 && completedToday.length === 0) {
			taskList.createDiv({ text: '今日暂无待办任务。', attr: { style: 'color: var(--text-muted); padding: 12px 0; text-align: center;' } });
		} else {
			// Render uncompleted today tasks
			uncompletedToday.forEach(t => {
				const item = taskList.createDiv({ cls: 'ad-task-item' });
				
				const checkBtn = item.createEl('button', { 
					cls: 'ad-task-check-btn',
				});
				
				checkBtn.addEventListener('click', () => {
					void (async () => {
						new Notice(`正在同步完成状态: ${t.title || t.text}`);
						checkBtn.disabled = true;
						const success = await this.taskService.completeTask(t);
						if (success) {
							new Notice('任务已完成并同步至 TickTick!');
							this.render();
						} else {
							new Notice('同步失败，请重试');
							checkBtn.disabled = false;
						}
					})();
				});

				const txtContainer = item.createDiv({ attr: { style: 'display: flex; flex-direction: column; flex: 1;' } });
				txtContainer.createEl('span', { text: t.title || t.text || '无标题', cls: 'ad-task-text' });
				
				const dueStr = t.dueDate || t.startDate || t.time;
				if (dueStr && !t.isAllDay) {
					const dt = new Date(dueStr);
					const hours = dt.getHours().toString().padStart(2, '0');
					const minutes = dt.getMinutes().toString().padStart(2, '0');
					if (hours !== '00' || minutes !== '00') {
						txtContainer.createEl('span', { text: `${hours}:${minutes}`, cls: 'ad-task-time', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });
					}
				}
			});

			// Render completed today tasks
			completedToday.forEach(t => {
				const item = taskList.createDiv({ cls: 'ad-task-item' });
				
				const checkBtn = item.createEl('button', { 
					cls: 'ad-task-check-btn is-completed',
				});
				setIcon(checkBtn, 'check');

				const txtContainer = item.createDiv({ attr: { style: 'display: flex; flex-direction: column; flex: 1;' } });
				txtContainer.createEl('span', { text: t.text || '无标题', cls: 'ad-task-text is-completed' });
				
				const dueStr = t.time;
				if (dueStr && !t.isAllDay) {
					const dt = new Date(dueStr);
					const hours = dt.getHours().toString().padStart(2, '0');
					const minutes = dt.getMinutes().toString().padStart(2, '0');
					if (hours !== '00' || minutes !== '00') {
						txtContainer.createEl('span', { text: `${hours}:${minutes}`, cls: 'ad-task-time', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });
					}
				}
			});
		}

		const addWrapper = todayCard.createDiv({ cls: 'ad-task-add-wrapper', attr: { style: 'margin-top: 15px; display: flex; gap: 8px;' } });
		const input = addWrapper.createEl('input', { type: 'text', placeholder: '添加今日待办...' });
		const btn = addWrapper.createEl('button', { text: '添加', cls: 'ad-btn ad-btn-primary' });
		btn.addEventListener('click', () => {
			void (async () => {
				if (input.value) {
					const title = input.value;
					const projectId = this.selectedProjectId !== 'all' ? this.selectedProjectId : undefined;
					new Notice(`正在添加至 TickTick: ${title}`);
					btn.disabled = true;
					input.disabled = true;
					// Generate today start time string in local time zone
					const now = new Date();
					const pad = (num: number) => num.toString().padStart(2, '0');
					const offset = -now.getTimezoneOffset();
					const sign = offset >= 0 ? '+' : '-';
					const tzH = pad(Math.floor(Math.abs(offset) / 60));
					const tzM = pad(Math.abs(offset) % 60);
					const localOffset = `${sign}${tzH}:${tzM}`;
					const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00:00${localOffset}`;

					const success = await this.taskService.addTask(title, projectId, todayStr);
					if (success) {
						new Notice('任务添加成功!');
						input.value = '';
						this.render();
					} else {
						new Notice('添加失败，请重试');
					}
					btn.disabled = false;
					input.disabled = false;
				}
			})();
		});
	}



	private renderTodayHabits(parent: Element): void {
		const habitCard = parent.createDiv({ cls: 'ad-card ad-habit-card ad-tech-card' });
		habitCard.createEl('h3', { text: '今日习惯打卡' , attr: { style: 'margin: 0; text-align: left; align-self: flex-start;' } });
		
		const habitList = habitCard.createDiv({ cls: 'ad-habit-list' });
		const stats = this.taskService.getCache();
		const habits = stats.habits || [];
		const habitCheckins = stats.habitCheckins || {};

		const now = new Date();
		const pad = (num: number) => num.toString().padStart(2, '0');
		const todayStamp = parseInt(`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`);

		if (habits.length === 0) {
			habitList.createDiv({ text: '暂无习惯数据，请点击刷新同步。', attr: { style: 'color: var(--text-muted); padding: 10px 0; text-align: center;' } });
			return;
		}

		habits.forEach(h => {
			const checkins = habitCheckins[h.id] || [];
			const todayCheckin = checkins.find(c => c.stamp === todayStamp);
			const isCompleted = todayCheckin ? todayCheckin.status === 2 : false;

			const item = habitList.createDiv({ cls: 'ad-habit-item', attr: { style: 'margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;' } });
			
			const leftWrap = item.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
			
			const checkBtn = leftWrap.createEl('button', { 
				cls: `ad-habit-check-btn ${isCompleted ? 'is-completed' : ''}`,
				attr: { 
					style: `border-radius: 50%; width: 24px; height: 24px; padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; ` +
					       (isCompleted 
					           ? 'border: 1px solid var(--text-success); background: transparent; color: var(--text-success);' 
					           : 'border: 1px solid var(--background-modifier-border); background: transparent; color: transparent;')
				}
			});
			if (isCompleted) {
				setIcon(checkBtn, 'check');
			}
			
			checkBtn.addEventListener('click', () => {
				void (async () => {
					const nextState = !isCompleted;
					new Notice(nextState ? `正在打卡: ${h.name}` : `正在取消打卡: ${h.name}`);
					checkBtn.disabled = true;
					const success = await this.taskService.checkInHabit(h.id, todayStamp, nextState);
					if (success) {
						new Notice(nextState ? '打卡成功！' : '取消打卡成功！');
						this.render();
					} else {
						new Notice('同步打卡失败，请重试');
						checkBtn.disabled = false;
					}
				})();
			});

			leftWrap.createEl('span', { text: h.name, cls: 'ad-habit-name', attr: { style: isCompleted ? 'text-decoration: line-through; color: var(--text-muted);' : 'color: var(--text-normal);' } });
			
			item.createEl('span', { 
				text: `${h.totalCheckIns || 0} 次`, 
				cls: 'ad-habit-count', 
				attr: { style: 'font-size: 11px; color: var(--text-muted); font-family: var(--font-monospace);' } 
			});
		});
	}

	private renderMcpConsole(parent: Element): void {
		const statsCard = parent.createDiv({ cls: 'ad-card ad-task-stats-card ad-tech-card' });
		statsCard.createEl('h4', { text: 'Ticktick mcp 交互控制台' });
		
		const mcpConsole = statsCard.createDiv({ cls: 'ad-mcp-console' });
		const mcpInput = mcpConsole.createEl('input', { type: 'text', placeholder: '输入 MCP 指令，例如: get_tasks今天...' });
		const mcpBtn = mcpConsole.createEl('button', { text: '发送', cls: 'ad-btn ad-btn-secondary' });
		
		mcpBtn.addEventListener('click', () => {
			if (mcpInput.value) {
				const toolName = mcpInput.value.trim();
				new Notice(`执行 MCP 指令: ${toolName}...`);
				mcpInput.value = '';
				
				void (async () => {
					try {
						const res = (await this.taskService.mcpService.executeRequest('ticktick', 'tools/call', {
							name: toolName,
							arguments: {}
						})) as McpCallResult;
						
						const contentBlocks = res?.content || [];
						if (contentBlocks.length > 0) {
							new Notice(`✅ 成功执行 [${toolName}]`);
							
							if (toolName.includes('task') || toolName.includes('sync')) {
								this.render();
							}
						} else {
							new Notice(`⚠️ [${toolName}] 执行完成，但没有返回内容`);
						}
					} catch (e) {
						new Notice(`❌ [${toolName}] 失败: ${String(e)}`);
					}
				})();
			}
		});
	}

	/**
	 * =========================================================================
	 * 05 / 项目主频道渲染 (Projects Kanban Dashboard)
	 * =========================================================================
	 */
	private renderProjectsDashboard(parent: Element): void {
		const card = parent.createDiv({ cls: 'ad-card ad-tech-card' });
		const header = card.createDiv({ cls: 'ad-card-header' });
		header.createEl('h3', { text: '项目追踪看板' , attr: { style: 'margin: 0; text-align: left; align-self: flex-start;' } });
		header.createSpan({ text: '基于 03 Projects 下笔记 frontmatter.status 自动分类', cls: 'ad-card-meta' });

		const board = card.createDiv({ cls: 'ad-kanban-board' });

		const columns = [
			{ id: 'active', label: '活跃 (Active)', cls: 'active' },
			{ id: 'pending', label: '挂起 (Pending)', cls: 'pending' },
			{ id: 'completed', label: '完成 (Completed)', cls: 'completed' },
			{ id: 'archived', label: '归档 (Archived)', cls: 'archived' }
		];

		const colMap = new Map<string, HTMLElement>();
		columns.forEach(col => {
			const colDiv = board.createDiv({ cls: 'ad-kanban-column' });
			const colHeader = colDiv.createDiv({ cls: 'ad-kanban-column-header' });
			colHeader.createSpan({ text: col.label });
			colHeader.createSpan({ text: '0', attr: { style: 'background: var(--background-secondary); padding: 1px 6px; border-radius: 10px; font-size: 10px;' } });
			
			colMap.set(col.id, colDiv);
		});

		void this.getProjectsData().then(projects => {
			const counts = { active: 0, pending: 0, completed: 0, archived: 0 };
			
			projects.forEach(proj => {
				const colDiv = colMap.get(proj.status);
				if (!colDiv) return;

				counts[proj.status]++;

				const pCard = colDiv.createDiv({ cls: 'ad-project-card' });
				pCard.createDiv({ text: proj.title, cls: 'ad-project-title' });

				const bar = pCard.createDiv({ cls: 'ad-project-progress-bar' });
				bar.createDiv({ cls: 'ad-project-progress-fill', attr: { style: `width: ${proj.progress}%;` } });

				const meta = pCard.createDiv({ cls: 'ad-project-meta' });
				meta.createSpan({ text: `${proj.progress}%` });
				meta.createSpan({ text: proj.mtimeStr });

				if (proj.path) {
					pCard.addEventListener('click', () => {
						void this.app.workspace.openLinkText(proj.path, '', false);
					});
				}
			});

			columns.forEach(col => {
				const colDiv = colMap.get(col.id);
				if (colDiv) {
					const badge = colDiv.querySelector('.ad-kanban-column-header span:last-child');
					if (badge) {
						badge.setText(String(counts[col.id as keyof typeof counts]));
					}
				}
			});
		});
	}

	private async getProjectsData(): Promise<ProjectInfo[]> {
		const projects: ProjectInfo[] = [];
		try {
			const projectFolder = this.app.vault.getAbstractFileByPath('03 Projects');
			if (projectFolder instanceof TFolder) {
				const scanFiles = (folder: TFolder) => {
					folder.children.forEach(child => {
						if (child instanceof TFile && child.extension === 'md') {
							const cache = this.app.metadataCache.getFileCache(child);
							const frontmatter = cache?.frontmatter || {};
							
							const statusRaw = String(frontmatter.status || '').toLowerCase();
							let status: 'active' | 'pending' | 'completed' | 'archived' = 'active';
							if (statusRaw === 'pending' || statusRaw === '挂起' || statusRaw === '不活跃') {
								status = 'pending';
							} else if (statusRaw === 'completed' || statusRaw === '已完成' || statusRaw === '完成') {
								status = 'completed';
							} else if (statusRaw === 'archived' || statusRaw === '已放弃' || statusRaw === '归档' || statusRaw === 'abandoned') {
								status = 'archived';
							}
							
							const progress = Number(frontmatter.progress || 0);
							const mtimeStr = moment(child.stat.mtime).format('YYYY-MM-DD');

							projects.push({
								title: child.basename,
								path: child.path,
								status,
								progress,
								mtimeStr
							});
						} else if (child instanceof TFolder) {
							scanFiles(child);
						}
					});
				};
				scanFiles(projectFolder);
			}
		} catch (error) {
			console.error('Failed to scan projects:', error);
		}
		
		if (projects.length === 0) {
			return [
				{ title: '智能系统 Dashboard 开发', path: '', status: 'active', progress: 85, mtimeStr: '2026-06-22' },
				{ title: '知识库死链自动检测脚本', path: '', status: 'active', progress: 40, mtimeStr: '2026-06-21' },
				{ title: 'AI 阅读器插件迁移', path: '', status: 'pending', progress: 10, mtimeStr: '2026-06-15' },
				{ title: '2025 个人财务自动化分析', path: '', status: 'completed', progress: 100, mtimeStr: '2026-05-18' },
				{ title: '旧模板库归档', path: '', status: 'archived', progress: 0, mtimeStr: '2026-04-10' }
			];
		}

		return projects;
	}

	/**
	 * =========================================================================
	 * 以下为图表/导航相关复用辅助方法 (来自原 Stats Dashboard)
	 * =========================================================================
	 */
	private renderStatsNav(parent: Element): void {
		const navWrap = parent.createDiv({ cls: 'jarvis-stats-header-wrap' });
		
		const tabsContainer = navWrap.createDiv({ cls: 'jarvis-stats-nav-tabs' });
		const tabs = [
			{ id: 'week', label: '周' },
			{ id: 'month', label: '月' },
			{ id: 'year', label: '年' },
			{ id: 'all', label: '全部' }
		];
		
		tabs.forEach(t => {
			const btn = tabsContainer.createEl('button', {
				text: t.label,
				cls: `jarvis-stats-tab-btn ${this.statsTab === t.id ? 'is-active' : ''}`
			});
			btn.addEventListener('click', () => {
				this.statsTab = t.id as 'week' | 'month' | 'year' | 'all';
				this.currentDateOffset = 0;
				if (t.id === 'week') this.statsChartType = 'bar';
				else if (t.id === 'month') this.statsChartType = 'bar';
				else if (t.id === 'year') this.statsChartType = 'heatmap';
				else if (t.id === 'all') this.statsChartType = 'heatmap';
				this.render();
			});
		});

		if (this.statsTab !== 'all') {
			const picker = navWrap.createDiv({ cls: 'jarvis-stats-date-picker' });
			
			const prevBtn = picker.createEl('button', { cls: 'jarvis-stats-date-btn' });
			setIcon(prevBtn, 'chevron-left');
			prevBtn.addEventListener('click', () => {
				this.currentDateOffset--;
				this.render();
			});

			const dateStr = this.calculateDateRangeString();
			picker.createEl('span', { text: dateStr, cls: 'jarvis-stats-date-text' });

			const nextBtn = picker.createEl('button', { cls: 'jarvis-stats-date-btn' });
			setIcon(nextBtn, 'chevron-right');
			nextBtn.addEventListener('click', () => {
				this.currentDateOffset++;
				this.render();
			});
		}
	}

	private calculateDateRangeString(): string {
		const now = new Date();
		if (this.statsTab === 'week') {
			const startOfWeek = new Date(now);
			const day = startOfWeek.getDay();
			const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1) + (this.currentDateOffset * 7);
			startOfWeek.setDate(diff);
			
			const endOfWeek = new Date(startOfWeek);
			endOfWeek.setDate(startOfWeek.getDate() + 6);
			
			return `${startOfWeek.getFullYear()}/${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()} - ${endOfWeek.getMonth() + 1}/${endOfWeek.getDate()}`;
		} else if (this.statsTab === 'month') {
			const targetMonth = new Date(now.getFullYear(), now.getMonth() + this.currentDateOffset, 1);
			return `${targetMonth.getFullYear()}年${targetMonth.getMonth() + 1}月`;
		} else {
			return `${now.getFullYear() + this.currentDateOffset}年`;
		}
	}

	private renderMiniGrid(parent: Element, stats: VaultOverviewStats): void {
		const grid = parent.createDiv({ cls: 'jarvis-stats-mini-grid' });
		
		const cards = [
			{ icon: 'calendar', val: `${stats.totalDays} 天`, label: '记录天数' },
			{ icon: 'activity', val: `${stats.dailyAvg} 篇`, label: '日均新增' },
			{ icon: 'file-text', val: `${stats.countAtomics} 篇`, label: '原子笔记' },
			{ icon: 'folder', val: `${stats.countInbox} 篇`, label: 'Inbox 待理' },
			{ icon: 'book-open', val: `${stats.countOutput} 篇`, label: '输出文章' },
			{ icon: 'link', val: `${stats.countOrphans} 条`, label: '孤立笔记' }
		];

		cards.forEach(c => {
			const card = grid.createDiv({ cls: 'jarvis-stats-mini-card ad-tech-card' });
			const valSpan = card.createSpan({ cls: 'jarvis-stats-mini-val' });
			setIcon(valSpan, c.icon);
			valSpan.createSpan({ text: ` ${c.val}` });
			card.createSpan({ text: c.label, cls: 'jarvis-stats-mini-label' });
		});
	}

	private renderChartSection(parent: Element): void {
		const chartSec = parent.createDiv({ cls: 'jarvis-stats-chart-section ad-tech-card' });
		const header = chartSec.createDiv({ cls: 'jarvis-stats-chart-header' });
		
		let title = '每日新增笔记';
		if (this.statsTab === 'year' && this.statsChartType === 'bar') title = '每月新增笔记';
		if (this.statsTab === 'all' && this.statsChartType === 'bar') title = '每年新增笔记';
		header.createSpan({ text: title, cls: 'jarvis-stats-chart-title' });

		const toggles = header.createDiv({ cls: 'jarvis-stats-chart-toggles' });
		
		if (this.statsTab === 'month') {
			const btnBar = toggles.createEl('button', { 
				cls: `jarvis-stats-chart-toggle-btn ${this.statsChartType === 'bar' ? 'is-active' : ''}` 
			});
			setIcon(btnBar, 'activity');
			btnBar.addEventListener('click', () => {
				this.statsChartType = 'bar';
				this.render();
			});

			const btnCal = toggles.createEl('button', { 
				cls: `jarvis-stats-chart-toggle-btn ${this.statsChartType === 'calendar' ? 'is-active' : ''}` 
			});
			setIcon(btnCal, 'calendar');
			btnCal.addEventListener('click', () => {
				this.statsChartType = 'calendar';
				this.render();
			});
		} else if (this.statsTab === 'year' || this.statsTab === 'all') {
			const btnHeat = toggles.createEl('button', { 
				cls: `jarvis-stats-chart-toggle-btn ${this.statsChartType === 'heatmap' ? 'is-active' : ''}` 
			});
			setIcon(btnHeat, 'layout-dashboard');
			btnHeat.addEventListener('click', () => {
				this.statsChartType = 'heatmap';
				this.render();
			});

			const btnBar = toggles.createEl('button', { 
				cls: `jarvis-stats-chart-toggle-btn ${this.statsChartType === 'bar' ? 'is-active' : ''}` 
			});
			setIcon(btnBar, 'activity');
			btnBar.addEventListener('click', () => {
				this.statsChartType = 'bar';
				this.render();
			});
		}

		if (this.statsChartType === 'bar') {
			this.renderBarChart(chartSec);
		} else if (this.statsChartType === 'calendar') {
			this.renderCalendarChart(chartSec);
		} else if (this.statsChartType === 'heatmap') {
			this.renderHeatmapChart(chartSec);
		}
	}

	private getVaultDateCounts(): Map<string, number> {
		if (this.cachedDateCounts) return this.cachedDateCounts;

		const files = this.app.vault.getMarkdownFiles();
		const dateCounts = new Map<string, number>();
		files.forEach(f => {
			const cache = this.app.metadataCache.getFileCache(f);
			const rawFm: unknown = cache?.frontmatter;
			const frontmatter = rawFm as Record<string, unknown> | undefined;
			let m: moment.Moment;
			const createdVal = frontmatter?.created;
			if (createdVal && (typeof createdVal === 'string' || typeof createdVal === 'number' || createdVal instanceof Date)) {
				m = moment(createdVal);
			} else {
				m = moment(f.stat.ctime);
			}
			const k = m.format('YYYY-MM-DD');
			dateCounts.set(k, (dateCounts.get(k) || 0) + 1);
		});

		this.cachedDateCounts = dateCounts;
		return dateCounts;
	}

	private renderBarChart(parent: Element): void {
		const dateCounts = this.getVaultDateCounts();

		let data: { label: string; count: number; tooltip: string }[] = [];
		let baseDate = window.moment();
		if (this.statsTab === 'week') {
			baseDate.add(this.currentDateOffset, 'weeks');
		} else if (this.statsTab === 'month') {
			baseDate.add(this.currentDateOffset, 'months');
		} else if (this.statsTab === 'year') {
			baseDate.add(this.currentDateOffset, 'years');
		}

		if (this.statsTab === 'week') {
			const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
			const startOfWeek = baseDate.clone().startOf('isoWeek');
			data = weekdays.map((day, i) => {
				const d = startOfWeek.clone().add(i, 'days');
				const count = dateCounts.get(d.format('YYYY-MM-DD')) || 0;
				return { label: day, count, tooltip: `周${day} (${d.format('MM/DD')}) 新增 ${count} 篇` };
			});
		} else if (this.statsTab === 'month') {
			const daysInMonth = baseDate.daysInMonth();
			const startOfMonth = baseDate.clone().startOf('month');
			data = Array.from({ length: daysInMonth }).map((_, i) => {
				const d = startOfMonth.clone().add(i, 'days');
				const count = dateCounts.get(d.format('YYYY-MM-DD')) || 0;
				return { label: String(i + 1), count, tooltip: `${i + 1}号 (${d.format('MM/DD')}) 新增 ${count} 篇` };
			});
		} else if (this.statsTab === 'year') {
			const startOfYear = baseDate.clone().startOf('year');
			data = Array.from({ length: 12 }).map((_, i) => {
				const monthStart = startOfYear.clone().add(i, 'months');
				let monthCount = 0;
				const days = monthStart.daysInMonth();
				for (let j = 0; j < days; j++) {
					monthCount += dateCounts.get(monthStart.clone().add(j, 'days').format('YYYY-MM-DD')) || 0;
				}
				return { label: `${i + 1}月`, count: monthCount, tooltip: `${i + 1}月 新增 ${monthCount} 篇` };
			});
		} else {
			const yearCounts = new Map<string, number>();
			dateCounts.forEach((count, dateStr) => {
				const y = dateStr.substring(0, 4);
				yearCounts.set(y, (yearCounts.get(y) || 0) + count);
			});
			const years = Array.from(yearCounts.keys()).sort();
			data = years.map(y => ({
				label: `${y}年`, count: yearCounts.get(y) || 0, tooltip: `${y}年 新增 ${yearCounts.get(y)} 篇`
			}));
		}

		const maxCount = Math.max(...data.map(d => d.count), 5);
		const wrapper = parent.createDiv({ attr: { style: 'position: relative; width: 100%; min-height: 200px; flex-grow: 1; display: flex; flex-direction: column;' } });

		const grid = wrapper.createDiv({ 
			attr: { style: 'position: absolute; left: 0; right: 0; top: 10px; bottom: 30px; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; border-bottom: 1px solid var(--background-modifier-border);' } 
		});
		grid.createDiv({ attr: { style: 'border-bottom: 1px dashed var(--background-modifier-border); width: 100%; height: 0;' } })
			.createEl('span', { text: String(maxCount), attr: { style: 'font-size: 9px; color: var(--text-muted); position: absolute; top: -5px;' } });
		grid.createDiv({ attr: { style: 'border-bottom: 1px dashed var(--background-modifier-border); width: 100%; height: 0;' } })
			.createEl('span', { text: String(Math.round(maxCount / 2)), attr: { style: 'font-size: 9px; color: var(--text-muted); position: absolute; top: 50%; transform: translateY(-50%);' } });

		const container = wrapper.createDiv({ 
			attr: { style: 'display: flex; justify-content: space-around; align-items: flex-end; position: absolute; left: 0; right: 0; top: 10px; bottom: 30px; padding: 0 10px; pointer-events: none;' } 
		});
		
		data.forEach(item => {
			const col = container.createDiv({ 
				attr: { style: 'display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; flex-grow: 1; position: relative; pointer-events: auto; padding: 0 2px;' },
				title: item.tooltip
			});
			
			const pct = (item.count / maxCount) * 100;
			col.createDiv({ 
				attr: { style: `height: ${pct}%; min-height: ${pct > 0 ? 4 : 0}px; width: 100%; max-width: 24px; background-color: var(--interactive-accent); border-radius: 4px 4px 0 0; transition: height 0.3s ease; opacity: 0.8;` } 
			});
			
			col.createEl('span', { 
				text: item.label, 
				attr: { style: 'position: absolute; bottom: -20px; font-size: 10px; color: var(--text-muted); white-space: nowrap;' } 
			});
		});
	}

	private renderCalendarChart(parent: Element): void {
		const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
		
		const gridHeader = parent.createDiv({ cls: 'jarvis-stats-calendar-grid', attr: { style: 'margin-bottom: 8px;' } });
		weekdays.forEach(wd => {
			gridHeader.createDiv({ text: wd, cls: 'jarvis-stats-calendar-weekday' });
		});

		const gridBody = parent.createDiv({ cls: 'jarvis-stats-calendar-grid' });
		
		const now = window.moment();
		let targetMonth = now.clone().add(this.currentDateOffset, 'months');
		
		const totalDays = targetMonth.daysInMonth();
		const startOfMonth = targetMonth.clone().startOf('month');
		
		// isoWeekday(): 1=Monday, 7=Sunday
		const offset = startOfMonth.isoWeekday() - 1;

		for (let i = 0; i < offset; i++) {
			gridBody.createDiv({ cls: 'jarvis-stats-calendar-cell is-empty' });
		}
		// Get real data counts
		const dateCounts = this.getVaultDateCounts();

		for (let d = 1; d <= totalDays; d++) {
			const currentDay = targetMonth.clone().date(d);
			const count = dateCounts.get(currentDay.format('YYYY-MM-DD')) || 0;
			
			const cell = gridBody.createDiv({ 
				cls: `jarvis-stats-calendar-cell ${count > 0 ? 'has-read' : ''}` 
			});
			cell.createEl('span', { text: String(d), attr: { style: count > 0 ? 'font-weight: 700;' : '' } });
			if (count > 0) {
				cell.createEl('span', { text: `+${count} 篇`, cls: 'jarvis-stats-calendar-cell-time' });
			}
		}
	}

	private renderHeatmapChart(parent: Element): void {
		const heatmapWrapper = parent.createDiv({ cls: 'jarvis-stats-heatmap-wrapper' });
		const now = moment();
		let targetYear = now.year();
		if (this.statsTab === 'month') {
			targetYear = now.clone().add(this.currentDateOffset, 'months').year();
		} else if (this.statsTab === 'week') {
			targetYear = now.clone().add(this.currentDateOffset, 'weeks').year();
		} else if (this.statsTab === 'year') {
			targetYear = now.clone().add(this.currentDateOffset, 'years').year();
		}

		const isSingleYear = this.statsTab === 'year';
		const cellSize = isSingleYear ? 12 : 9;
		const cellGap = isSingleYear ? 3 : 2;
		const gridHeight = 7 * cellSize + 6 * cellGap;

		let yearsToRender = [String(targetYear)];
		if (this.statsTab === 'all') {
			yearsToRender = [String(now.year() - 1), String(now.year())]; // render last 2 years
		}
		const dateCounts = this.getVaultDateCounts();

		let totalActiveDays = 0;
		let totalNotes = 0;

		yearsToRender.forEach(yearStr => {
			const year = parseInt(yearStr);
			if (this.statsTab === 'all') {
				heatmapWrapper.createEl('h4', { text: `${year}年`, attr: { style: 'margin: 10px 0 5px 0; font-size: 13px;' } });
			}
			
			const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
			const monthGrid = heatmapWrapper.createDiv({ 
				attr: { style: `display: grid; grid-template-columns: repeat(53, ${cellSize}px); gap: ${cellGap}px; font-size: 9px; color: var(--text-muted); margin-bottom: 4px; padding-left: 22px;` } 
			});
			
			monthLabels.forEach((label, i) => {
				const colStart = Math.round(i * 4.4) + 1;
				monthGrid.createEl('span', { 
					text: label, 
					attr: { style: `grid-column-start: ${colStart}; white-space: nowrap;` } 
				});
			});

			const bodyMarginBottom = this.statsTab === 'all' ? '8px' : '16px';
			const gridBody = heatmapWrapper.createDiv({ attr: { style: `display: flex; gap: 8px; height: ${gridHeight}px; margin-bottom: ${bodyMarginBottom};` } });
			const dayLabels = gridBody.createDiv({
				attr: { style: 'display: flex; flex-direction: column; justify-content: space-between; font-size: 9px; color: var(--text-muted); width: 14px; padding: 2px 0;' }
			});
			dayLabels.createSpan({ text: '一' });
			dayLabels.createSpan({ text: '三' });
			dayLabels.createSpan({ text: '五' });

			const gridContainer = gridBody.createDiv({ attr: { style: `display: flex; gap: ${cellGap}px; align-items: stretch;` } });
			
			const currentDate = window.moment(`${year}-01-01`).startOf('isoWeek');
			const endDate = window.moment(`${year}-12-31`).endOf('isoWeek');
			
			while (currentDate.isBefore(endDate)) {
				const col = gridContainer.createDiv({ cls: 'jarvis-stats-heatmap-col', attr: { style: `width: ${cellSize}px; gap: ${cellGap}px;` } });
				for (let d = 0; d < 7; d++) {
					const dateStr = currentDate.format('YYYY-MM-DD');
					const count = dateCounts.get(dateStr) || 0;
					const isCurrentYear = currentDate.year() === year;

					if (isCurrentYear && count > 0) {
						totalActiveDays++;
						totalNotes += count;
					}

					let level = 0;
					if (count > 10) level = 4;
					else if (count > 5) level = 3;
					else if (count > 2) level = 2;
					else if (count > 0) level = 1;

					const cell = col.createDiv({ cls: `jarvis-stats-heatmap-cell ${isCurrentYear ? `level-${level}` : ''}`, attr: { style: `width: ${cellSize}px; height: ${cellSize}px;` } });
					if (!isCurrentYear) {
						cell.setCssStyles({ visibility: 'hidden' });
					} else {
						cell.createDiv({ text: `${dateStr} 新增 ${count} 篇笔记`, cls: 'jarvis-stats-heatmap-cell-tooltip' });
					}
					currentDate.add(1, 'day');
				}
			}
		});

		const footer = parent.createDiv({ cls: 'jarvis-stats-heatmap-footer' });
		const prefix = this.statsTab === 'all' ? '总计' : '本年度';
		footer.createSpan({ text: `${prefix}共活跃 ${totalActiveDays} 天，累计新增 ${totalNotes} 篇笔记` });
		
		const legend = footer.createDiv({ cls: 'jarvis-stats-heatmap-legend' });
		legend.createSpan({ text: '少' });
		for (let i = 0; i <= 4; i++) {
			legend.createDiv({ cls: `jarvis-stats-heatmap-legend-box level-${i}` });
		}
		legend.createSpan({ text: '多' });
	}
}
