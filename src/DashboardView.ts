import { ItemView, WorkspaceLeaf, Notice, setIcon, TFile, TFolder, moment, Modal, App } from 'obsidian';
import AgentDashboardPlugin from './main';
import { ReadingService } from './services/ReadingService';
import { DiaryService } from './services/DiaryService';
import { TaskService } from './services/TaskService';
import { VaultService } from './services/VaultService';

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
					this.app.workspace.openLinkText(filePath, '', true);
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
	private activeMainTab: 'vault' | 'diary' | 'lint' | 'tasks' | 'projects' = 'vault';
	private statsTab: 'week' | 'month' | 'year' | 'all' = 'week';
	private statsChartType: 'bar' | 'calendar' | 'heatmap' = 'bar';
	private periodicTab: 'day' | 'week' | 'month' | 'quarter' | 'year' = 'day';
	private currentDateOffset = 0; // 0 表示当前周期，-1 前一周期，+1 后一周期
	private diaryDateOffset = 0; // 0 表示当前周期，-1 前一周期，+1 后一周期 (for diary)
	private lastScanTime = '尚未进行体检';
	private isScanning = false;
	private historyStats = { ingested: 12, fixedLinks: 47, cleanedEmpty: 9 };
	private currentScanData: any = null;

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
		this.render();
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
		const telemetry = parent.createDiv({ cls: 'ad-top-telemetry' });
		
		// 1. Header Row (Title and Version Info)
		const headerRow = telemetry.createDiv({ attr: { style: 'position: relative; display: flex; justify-content: center; align-items: flex-end; margin-bottom: 24px;' } });
		
		// Left: Title (Centered)
		headerRow.createEl('h1', { text: 'BYLRB CORE OS', attr: { style: 'font-size: 24px; font-weight: 600 !important; margin: 0; color: var(--text-normal); letter-spacing: 0.5px;' } });
		
		// Right: Version and Days (Absolute positioning)
		const startDate = moment('2024-05-18');
		const diffDays = moment().diff(startDate, 'days');
		headerRow.createDiv({ text: `v1.2.0 · 已相伴 ${diffDays} 天`, attr: { style: 'position: absolute; right: 0; bottom: 2px; font-size: 14px; color: var(--text-muted); font-weight: 500;' } });

		// 2. Stats Bar (Long horizontal rounded bar)
		const statsBar = telemetry.createDiv({ cls: 'ad-stats-bar' });
		
		// Container for the stat items inside the bar
		const statsList = statsBar.createDiv({ attr: { style: 'display: flex; gap: 24px; align-items: center;' } });
		
		// Stat Item: MCP
		const mcpItem = statsList.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		mcpItem.createSpan({ text: 'MCP', attr: { style: 'color: var(--text-muted); font-size: 12px;' } });
		mcpItem.createSpan({ text: '联机', attr: { style: 'font-weight: 600; font-size: 14px;' } });

		// Stat Item: Inbox
		const inboxItem = statsList.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		inboxItem.createSpan({ text: '收件箱', attr: { style: 'color: var(--text-muted); font-size: 12px;' } });
		const inboxVal = inboxItem.createSpan({ text: '0', attr: { style: 'font-weight: 600; font-size: 14px;' } });

		// Stat Item: Tasks
		const tasksItem = statsList.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		tasksItem.createSpan({ text: '今日待办', attr: { style: 'color: var(--text-muted); font-size: 12px;' } });
		const tasksVal = tasksItem.createSpan({ text: '-', attr: { style: 'font-weight: 600; font-size: 14px;' } });

		// Update dynamically
		void this.vaultService.getInboxBacklog().then(info => {
			inboxVal.setText(String(info.count));
			if (info.count > 0) {
				inboxVal.setCssStyles({ color: 'var(--text-error)' });
			}
		});

		void this.taskService.getTaskStats().then(stats => {
			tasksVal.setText(`${stats.completedCount}/${stats.todayCount}`);
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
			{ id: 'tasks', label: '04 / 待办', icon: 'check-square' },
			{ id: 'projects', label: '05 / 项目', icon: 'kanban' }
		];

		mainTabs.forEach(t => {
			const btn = tabWrapper.createEl('button', { 
				cls: `ad-viewport-tab-btn ${this.activeMainTab === t.id ? 'is-active' : ''}` 
			});
			setIcon(btn, t.icon);
			btn.createSpan({ text: ` ${t.label}` });
			btn.addEventListener('click', () => {
				this.activeMainTab = t.id as 'vault' | 'diary' | 'lint' | 'tasks' | 'projects';
				this.render();
			});
		});

		const contentWrapper = parent.createDiv({ cls: 'ad-tab-content' });

		if (this.activeMainTab === 'vault') {
			this.renderVaultDashboard(contentWrapper);
		} else if (this.activeMainTab === 'diary') {
			this.renderDiaryDashboard(contentWrapper);
		} else if (this.activeMainTab === 'lint') {
			this.renderLintDashboard(contentWrapper);
		} else if (this.activeMainTab === 'tasks') {
			this.renderTasksDashboard(contentWrapper);
		} else if (this.activeMainTab === 'projects') {
			this.renderProjectsDashboard(contentWrapper);
		}
	}

	/**
	 * =========================================================================
	 * 01 / 仓库主频道渲染
	 * =========================================================================
	 */
	private renderVaultDashboard(parent: Element): void {
		const container = parent.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 20px;' } });
		
		this.renderStatsNav(container);
		
		const telemetryContainer = container.createDiv();
		const miniGridContainer = container.createDiv();
		const chartContainer = container.createDiv();

		telemetryContainer.createDiv({ text: '加载数据中...', attr: { style: 'color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;' } });

		void this.vaultService.getVaultOverviewStats().then(stats => {
			telemetryContainer.empty();
			miniGridContainer.empty();
			
			this.renderVaultTelemetryBar(telemetryContainer, stats);
			this.renderMiniGrid(miniGridContainer, stats);
			this.renderChartSection(chartContainer);
		});
	}

	private renderVaultTelemetryBar(parent: Element, stats: any): void {
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
		this.renderDiaryStatsCard(grid);
		this.renderCurrentPeriodicNote(grid);
		this.renderLastYearPreviewCard(grid);
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

		const now = moment().add(this.diaryDateOffset, this.periodicTab + 's' as any);
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

		const header = diaryCard.createDiv({ cls: 'ad-card-header', attr: { style: 'display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left;' } });
		header.createEl('h3', { text: `今日${currentName}`, attr: { style: 'margin: 0; text-align: left; align-self: flex-start;' } });
		
		const baseDate = moment().add(this.diaryDateOffset, this.periodicTab + 's' as any);
		const { folderPath, fileName, filePath } = this.diaryService.resolvePeriodicNotePath(baseDate, this.periodicTab);
		
		const badge = header.createSpan({ text: '加载中...', cls: 'ad-badge ad-badge-muted' });

		const content = diaryCard.createDiv({ cls: 'ad-diary-content', attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; margin-top: 12px;' } });
		
		const file = this.app.vault.getAbstractFileByPath(filePath);
		const isCreated = file instanceof TFile;

		const borderStyle = isCreated ? '2px solid var(--text-success)' : '2px dashed var(--background-modifier-border)';
		const innerDiv = content.createDiv({ attr: { style: `border: ${borderStyle}; border-radius: 8px; padding: 12px; flex-grow: 1; display: flex; flex-direction: column;` } });
		
		const pathEl = innerDiv.createEl('div', { text: filePath, cls: 'ad-diary-path', attr: { style: 'font-family: var(--font-monospace); font-size: 11px; margin-bottom: 10px; color: var(--text-muted);' } });
		const summaryEl = innerDiv.createEl('p', { text: `读取中...`, cls: 'ad-diary-summary', attr: { style: 'font-size: 13px; line-height: 1.5; color: var(--text-normal); flex-grow: 1; overflow-y: auto;' } });
		
		badge.setText(isCreated ? '已创建' : '未创建');
		badge.className = `ad-badge ${isCreated ? 'ad-badge-success' : 'ad-badge-warning'}`;

		if (isCreated && file) {
			void this.app.vault.read(file as TFile).then(fileContent => {
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

		} catch (e) {
			content.empty();
			content.createDiv({ text: '统计失败', attr: { style: 'color: var(--text-error); font-size: 13px; grid-column: span 2; text-align: center;' } });
		}
	}

	private async renderLastYearPreviewCard(parent: Element): Promise<void> {
		const card = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'display: flex; flex-direction: column;' } });
		const header = card.createDiv({ cls: 'ad-card-header' });
		
		const baseDate = moment().add(this.diaryDateOffset, this.periodicTab + 's' as any);
		const targetLabel = this.periodicTab === 'day' ? '去年今日' : 
							this.periodicTab === 'year' ? '去年' : 
							`去年同${this.periodicTab === 'week' ? '周' : this.periodicTab === 'month' ? '月' : '季'}`;
		
		header.createEl('h3', { text: `${targetLabel}回望` });

		const content = card.createDiv({ attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 12px; padding: 8px 0;' } });
		
		const innerDiv = content.createDiv({ attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: center;' } });
		innerDiv.createDiv({ text: '查询中...', attr: { style: 'color: var(--text-muted); font-size: 13px; text-align: center;' } });

		try {
			const info = await this.diaryService.getLastYearNote(baseDate, this.periodicTab);
			innerDiv.empty();

			if (info) {
				innerDiv.createDiv({ 
					text: info.path, 
					attr: { style: 'font-family: var(--font-monospace); font-size: 11px; color: var(--text-muted); word-break: break-all; margin-bottom: 8px;' } 
				});
				
				innerDiv.createDiv({ 
					text: info.summary,
					attr: { style: 'font-size: 13px; line-height: 1.6; color: var(--text-normal); background: color-mix(in srgb, var(--background-modifier-form-field) 50%, transparent); padding: 12px; border-radius: 6px; overflow-y: auto;' }
				});
			} else {
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

		} catch (e) {
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
		leftCard.createEl('h3', { text: '金库健康度', attr: { style: 'margin: 0; text-align: left; align-self: flex-start; width: 100%;' } });

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
		
		const inboxItem = topLogContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; border: 2px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const inboxLeft = inboxItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const inboxIconEl = inboxLeft.createDiv(); setIcon(inboxIconEl, 'inbox');
		const inboxTextWrap = inboxLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 0;' } });
		inboxTextWrap.createSpan({ text: '待分类文件', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const inboxDesc = inboxTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		const diaryItem = topLogContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; border: 2px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const diaryLeft = diaryItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const diaryIconEl = diaryLeft.createDiv(); setIcon(diaryIconEl, 'calendar');
		const diaryTextWrap = diaryLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 0;' } });
		diaryTextWrap.createSpan({ text: '待入库日记', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const diaryDesc = diaryTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		// Inspect layout (expanded)
		const bottomInspectContainer = rightCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 10px; flex-grow: 1; overflow-y: auto;' } });
		
		const orphanItem = bottomInspectContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'flex-grow: 1; justify-content: flex-start; align-items: center; cursor: pointer; padding: 12px; background: var(--background-primary); border-radius: 6px; border: 2px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const orphanLeft = orphanItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
		const orphanIconEl = orphanLeft.createDiv(); setIcon(orphanIconEl, 'compass');
		const orphanTextWrap = orphanLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px;' } });
		orphanTextWrap.createSpan({ text: '孤儿笔记 (Orphans)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const orphanDesc = orphanTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		const deadLinkItem = bottomInspectContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'flex-grow: 1; justify-content: flex-start; align-items: center; cursor: pointer; padding: 12px; background: var(--background-primary); border-radius: 6px; border: 2px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const deadLinkLeft = deadLinkItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
		const deadLinkIconEl = deadLinkLeft.createDiv(); setIcon(deadLinkIconEl, 'link');
		const deadLinkTextWrap = deadLinkLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px;' } });
		deadLinkTextWrap.createSpan({ text: '未解析死链 (Dead Links)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const deadLinkDesc = deadLinkTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		const emptyNoteItem = bottomInspectContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'flex-grow: 1; justify-content: flex-start; align-items: center; cursor: pointer; padding: 12px; background: var(--background-primary); border-radius: 6px; border: 2px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
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
			// @ts-ignore
			if (outputFolder && outputFolder.children) {
				// @ts-ignore
				const reportFiles = outputFolder.children.filter(f => 
					f.name.endsWith('.md') && f.name.startsWith('知识库体检报告-')
				);
				if (reportFiles.length > 0) {
					// Sort descending to get the latest date
					reportFiles.sort((a: any, b: any) => b.name.localeCompare(a.name));
					const latestReport = reportFiles[0];
					void this.app.workspace.openLinkText(latestReport.path, '', false);
				} else {
					// @ts-ignore
					new Notice('在 05 Output 中未找到任何体检报告');
				}
			} else {
				// @ts-ignore
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
					inboxItem.style.border = inbox.count > 0 ? '2px solid var(--text-success)' : '2px dashed var(--background-modifier-border)';
					diaryItem.style.border = uningested.count > 0 ? '2px solid var(--text-success)' : '2px dashed var(--background-modifier-border)';
					orphanItem.style.border = orphans.count > 0 ? '2px solid var(--text-success)' : '2px dashed var(--background-modifier-border)';
					deadLinkItem.style.border = deadLinks.count > 0 ? '2px solid var(--text-success)' : '2px dashed var(--background-modifier-border)';
					emptyNoteItem.style.border = empty.count > 0 ? '2px solid var(--text-success)' : '2px dashed var(--background-modifier-border)';

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
		const grid = wrapper.createDiv({ cls: 'ad-middle-grid', attr: { style: 'grid-template-columns: 1.6fr 1fr;' } });

		const leftCol = grid.createDiv({ cls: 'ad-tasks-main-col' });
		this.renderTodayTasks(leftCol);

		const rightCol = grid.createDiv({ cls: 'ad-tasks-side-col' });
		
		const progressCard = rightCol.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'text-align: center;' } });
		progressCard.createEl('h3', { text: '今日待办完成率' , attr: { style: 'margin: 0; text-align: left; align-self: flex-start;' } });
		
		const ringContainer = progressCard.createDiv({ cls: 'ad-progress-ring-container', attr: { style: 'margin: 15px auto;' } });
		const svg = ringContainer.createSvg('svg', { cls: 'ad-progress-ring', attr: { width: '120', height: '120' } });
		svg.createSvg('circle', { cls: 'ad-progress-ring-circle-bg', attr: { r: '45', cx: '60', cy: '60' } });
		const progressCircle = svg.createSvg('circle', {
			cls: 'ad-progress-ring-circle',
			attr: { r: '45', cx: '60', cy: '60', id: 'task-progress-circle' }
		});
		const textPercentage = ringContainer.createDiv({ cls: 'ad-progress-ring-text', text: '--%' });

		const statsText = progressCard.createDiv({ text: '加载待办统计中...', attr: { style: 'font-size: 13px; font-weight: 600;' } });
		const overdueText = progressCard.createDiv({ text: '', attr: { style: 'color: var(--text-error); font-size: 12px; font-weight: bold; margin-top: 6px;' } });

		void this.taskService.getTaskStats().then(stats => {
			const total = stats.todayCount || 1;
			const completed = stats.completedCount || 0;
			const pct = Math.round((completed / total) * 100);

			const strokeDashoffset = 282.7 - (pct / 100) * 282.7;
			progressCircle.setAttribute('stroke-dashoffset', String(strokeDashoffset));
			textPercentage.setText(`${pct}%`);

			statsText.setText(`今日任务已完成: ${completed} / ${total} 项`);
			if (stats.overdueCount > 0) {
				overdueText.setText(`注意：当前有 ${stats.overdueCount} 项任务已逾期！`);
			} else {
				overdueText.setText('今天没有逾期任务。');
				overdueText.setCssStyles({ color: 'var(--text-success)' });
			}
		});

		this.renderTodayHabits(rightCol);
		this.renderMcpConsole(rightCol);
	}

	private renderTodayTasks(parent: Element): void {
		const todayCard = parent.createDiv({ cls: 'ad-card ad-task-card ad-tech-card' });
		todayCard.createEl('h3', { text: '今日任务流' , attr: { style: 'margin: 0; text-align: left; align-self: flex-start;' } });
		
		const taskList = todayCard.createDiv({ cls: 'ad-task-list' });
		const tasks = [
			{ text: '完成 Agent Dashboard 框架布局重构', checked: false, time: '21:00' },
			{ text: '阅读《设计心理学》第 3 章并写感悟', checked: false, time: '22:30' },
			{ text: '整理 02 Inbox 中的 AI 调研报告文件', checked: true, time: '14:00' },
			{ text: '去超市采购牛奶和燕麦', checked: false, time: '17:30' }
		];

		tasks.forEach(t => {
			const item = taskList.createDiv({ cls: 'ad-task-item' });
			const check = item.createEl('input', { type: 'checkbox', attr: t.checked ? { checked: true } : {} });
			check.addEventListener('change', () => {
				new Notice(`更新任务状态: ${t.text}`);
			});
			item.createEl('span', { text: t.text, cls: `ad-task-text ${t.checked ? 'is-completed' : ''}` });
			if (t.time) {
				item.createEl('span', { text: t.time, cls: 'ad-task-time' });
			}
		});

		const addWrapper = todayCard.createDiv({ cls: 'ad-task-add-wrapper', attr: { style: 'margin-top: 15px; display: flex; gap: 8px;' } });
		const input = addWrapper.createEl('input', { type: 'text', placeholder: '添加新待办至 TickTick...' });
		const btn = addWrapper.createEl('button', { text: '添加', cls: 'ad-btn ad-btn-primary' });
		btn.addEventListener('click', () => {
			if (input.value) {
				new Notice(`添加待办: ${input.value}`);
				input.value = '';
			}
		});
	}

	private renderTodayHabits(parent: Element): void {
		const habitCard = parent.createDiv({ cls: 'ad-card ad-habit-card ad-tech-card' });
		habitCard.createEl('h3', { text: '今日习惯打卡' , attr: { style: 'margin: 0; text-align: left; align-self: flex-start;' } });
		
		const habitList = habitCard.createDiv({ cls: 'ad-habit-list' });
		const habits = [
			{ name: '早起 (07:30 前)', count: '22/30 天', checked: true },
			{ name: '背单词 (50个)', count: '15/30 天', checked: false },
			{ name: '喝水 (2L以上)', count: '3/3 次', checked: true },
			{ name: '运动健身 (30分钟)', count: '10/30 天', checked: false }
		];

		habits.forEach(h => {
			const item = habitList.createDiv({ cls: 'ad-habit-item' });
			const checkBtn = item.createEl('button', { 
				cls: `ad-habit-check-btn ${h.checked ? 'is-completed' : ''}` 
			});
			setIcon(checkBtn, h.checked ? 'check' : 'plus');
			checkBtn.addEventListener('click', () => {
				new Notice(`打卡习惯: ${h.name}`);
			});
			item.createEl('span', { text: h.name, cls: 'ad-habit-name' });
			item.createEl('span', { text: h.count, cls: 'ad-habit-count' });
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
				new Notice(`执行 MCP 指令: ${mcpInput.value}`);
				mcpInput.value = '';
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

	private renderMiniGrid(parent: Element, stats: any): void {
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

	private renderBarChart(parent: Element): void {
		const files = this.app.vault.getMarkdownFiles();
		const dateCounts = new Map<string, number>();
		files.forEach(f => {
			const cache = this.app.metadataCache.getFileCache(f);
			const frontmatter = cache?.frontmatter;
			let m: any;
			if (frontmatter && frontmatter.created) {
				m = window.moment(frontmatter.created);
			} else {
				m = window.moment(f.stat.ctime);
			}
			const k = m.format('YYYY-MM-DD');
			dateCounts.set(k, (dateCounts.get(k) || 0) + 1);
		});

		let data: { label: string; count: number; tooltip: string }[] = [];
		const today = window.moment();

		if (this.statsTab === 'week') {
			const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
			const startOfWeek = today.clone().startOf('isoWeek');
			data = weekdays.map((day, i) => {
				const d = startOfWeek.clone().add(i, 'days');
				const count = dateCounts.get(d.format('YYYY-MM-DD')) || 0;
				return { label: day, count, tooltip: `周${day} 新增 ${count} 篇` };
			});
		} else if (this.statsTab === 'month') {
			const daysInMonth = today.daysInMonth();
			const startOfMonth = today.clone().startOf('month');
			data = Array.from({ length: daysInMonth }).map((_, i) => {
				const d = startOfMonth.clone().add(i, 'days');
				const count = dateCounts.get(d.format('YYYY-MM-DD')) || 0;
				return { label: String(i + 1), count, tooltip: `${i + 1}号 新增 ${count} 篇` };
			});
		} else if (this.statsTab === 'year') {
			const startOfYear = today.clone().startOf('year');
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
		const wrapper = parent.createDiv({ attr: { style: 'position: relative; width: 100%;' } });

		const grid = wrapper.createDiv({ 
			attr: { style: 'position: absolute; left: 0; right: 0; top: 10px; bottom: 30px; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; border-bottom: 1px solid var(--background-modifier-border);' } 
		});
		grid.createDiv({ attr: { style: 'border-bottom: 1px dashed var(--background-modifier-border); width: 100%; height: 0;' } })
			.createEl('span', { text: String(maxCount), attr: { style: 'font-size: 9px; color: var(--text-muted); position: absolute; top: 0;' } });
		grid.createDiv({ attr: { style: 'border-bottom: 1px dashed var(--background-modifier-border); width: 100%; height: 0;' } })
			.createEl('span', { text: String(Math.round(maxCount / 2)), attr: { style: 'font-size: 9px; color: var(--text-muted); position: absolute; top: 50%;' } });

		const container = wrapper.createDiv({ cls: 'jarvis-stats-bar-chart-container' });
		data.forEach(item => {
			const col = container.createDiv({ cls: 'jarvis-stats-bar-column' });
			col.createDiv({ text: item.tooltip, cls: 'jarvis-stats-bar-tooltip' });
			
			const pct = (item.count / maxCount) * 85;
			col.createDiv({ 
				cls: 'jarvis-stats-bar', 
				attr: { style: `height: ${pct || 2}%; background-color: var(--color-accent);` } 
			});
			col.createEl('span', { text: item.label, cls: 'jarvis-stats-bar-label' });
		});
	}

	private renderCalendarChart(parent: Element): void {
		const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
		
		const gridHeader = parent.createDiv({ cls: 'jarvis-stats-calendar-grid', attr: { style: 'margin-bottom: 8px;' } });
		weekdays.forEach(wd => {
			gridHeader.createDiv({ text: wd, cls: 'jarvis-stats-calendar-weekday' });
		});

		const gridBody = parent.createDiv({ cls: 'jarvis-stats-calendar-grid' });
		const offset = 0;
		const totalDays = 30;

		for (let i = 0; i < offset; i++) {
			gridBody.createDiv({ cls: 'jarvis-stats-calendar-cell is-empty' });
		}

		for (let d = 1; d <= totalDays; d++) {
			const count = d % 3 === 0 ? Math.floor(Math.random() * 4) + 1 : 0;
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
		const files = this.app.vault.getMarkdownFiles();
		const dateCounts = new Map<string, number>();
		files.forEach(f => {
			const cache = this.app.metadataCache.getFileCache(f);
			const frontmatter = cache?.frontmatter;
			let m: any;
			if (frontmatter && frontmatter.created) {
				m = window.moment(frontmatter.created);
			} else {
				m = window.moment(f.stat.ctime);
			}
			const k = m.format('YYYY-MM-DD');
			dateCounts.set(k, (dateCounts.get(k) || 0) + 1);
		});

		const wrapper = parent.createDiv({ cls: 'jarvis-heatmap-wrapper' });
		const scrollContainer = wrapper.createDiv({ cls: 'jarvis-heatmap-scroll' });
		const grid = scrollContainer.createDiv({ cls: 'jarvis-heatmap-grid' });
		
		const today = window.moment();
		const maxDays = 730; // Limit to 2 years
		for (let i = maxDays; i >= 0; i--) {
			const d = today.clone().subtract(i, 'days');
			const k = d.format('YYYY-MM-DD');
			const count = dateCounts.get(k) || 0;
			
			let level = 0;
			if (count >= 4) level = 4;
			else if (count === 3) level = 3;
			else if (count === 2) level = 2;
			else if (count === 1) level = 1;
			
			const cell = grid.createDiv({ cls: `jarvis-heatmap-cell level-${level}` });
			cell.title = `${k} 新增 ${count} 篇`;
		}
	}
}
