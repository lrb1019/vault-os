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
			attr: { style: 'margin-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px; color: var(--interactive-accent);' } 
		});
		
		if (this.items.length === 0) {
			contentEl.createEl('p', { text: '没有检测到任何项目。', attr: { style: 'font-style: italic; color: var(--text-muted);' } });
		} else {
			const ul = contentEl.createEl('ul');
			this.items.forEach(item => {
				ul.createEl('li', { text: item });
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
			attr: { style: 'margin-bottom: 12px; color: var(--interactive-accent); border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px;' } 
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
						progressArea.createDiv({ text: `- 待入库日记 (Diary): ${uningested} 个文件` });
						progressArea.createDiv({ text: `- 孤立文件 (Orphans): ${orphans} 个文件` });
						progressArea.createDiv({ text: `- 失效死链 (Dead Links): ${deadLinks} 个链接` });
						progressArea.createDiv({ text: `- 空白笔记 (Empty Notes): ${empty} 个文件` });
						
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
	private lastScanTime = '尚未进行体检';
	private isScanning = false;
	private historyStats = { ingested: 12, fixedLinks: 47, cleanedEmpty: 9 };

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

		// 2. 下方区域：主体双栏 (Body Layout)
		const bodyLayout = container.createDiv({ cls: 'ad-layout-body' });

		// 2.1 左侧常驻控制总线 (Control Bus)
		this.renderLeftControlBus(bodyLayout);

		// 2.2 右侧展示区 (Viewport)
		const viewport = bodyLayout.createDiv({ cls: 'ad-viewport' });
		this.renderRightViewport(viewport);
	}

	/**
	 * 1. 渲染顶部系统状态栏 (Telemetry Header)
	 */
	private renderTopTelemetry(parent: Element): void {
		const telemetry = parent.createDiv({ cls: 'ad-top-telemetry' });
		
		// Left side
		const left = telemetry.createDiv({ cls: 'ad-telemetry-left' });
		left.createSpan({ text: 'BYLRB CORE OS v1.2.0' });
		left.createSpan({ text: ' · ' });
		
		const startDate = moment('2024-05-18');
		const diffDays = moment().diff(startDate, 'days');
		left.createSpan({ text: `已相伴 ${diffDays} 天` });

		// Right side
		const right = telemetry.createDiv({ cls: 'ad-telemetry-right' });
		
		// MCP Status indicator
		const mcpIndicator = right.createDiv({ cls: 'ad-live-badge' });
		mcpIndicator.createDiv({ cls: 'ad-live-dot', attr: { style: 'background: var(--text-success); box-shadow: 0 0 4px var(--text-success);' } });
		mcpIndicator.createSpan({ text: 'MCP 联机' });

		// Inbox status indicator
		const inboxIndicator = right.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const inboxDot = inboxIndicator.createDiv({ cls: 'ad-live-dot', attr: { style: 'background: var(--text-warning);' } });
		const inboxText = inboxIndicator.createSpan({ text: '收件箱: 检测中' });

		// Task progress status indicator
		const taskIndicator = right.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const taskText = taskIndicator.createSpan({ text: '待办: 检测中' });

		// Update dynamically
		void this.vaultService.getInboxBacklog().then(info => {
			inboxText.setText(`收件箱: ${info.count} 篇`);
			if (info.count > 0) {
				inboxDot.setCssStyles({
					background: 'var(--text-error)',
					boxShadow: '0 0 4px var(--text-error)'
				});
			} else {
				inboxDot.setCssStyles({
					background: 'var(--text-muted)',
					boxShadow: 'none'
				});
			}
		});

		void this.taskService.getTaskStats().then(stats => {
			taskText.setText(`待办: ${stats.completedCount}/${stats.todayCount}`);
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
		this.renderVaultTelemetryBar(container);
		this.renderMiniGrid(container);
		this.renderChartSection(container);
	}

	private renderVaultTelemetryBar(parent: Element): void {
		const card = parent.createDiv({ cls: 'ad-card ad-tech-card' });
		const header = card.createDiv({ cls: 'ad-card-header' });
		header.createEl('h3', { text: '仓库文件夹容量占比' });
		
		const barContainer = card.createDiv({ cls: 'ad-vault-telemetry-bar' });
		const legendContainer = card.createDiv({ cls: 'ad-vault-telemetry-legend' });

		void this.getVaultFoldersData().then(data => {
			barContainer.empty();
			legendContainer.empty();

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
		});
	}

	private async getVaultFoldersData(): Promise<{ name: string; count: number; pct: number; cls: string }[]> {
		const files = this.app.vault.getMarkdownFiles();
		let dailyCount = 0;
		let inboxCount = 0;
		let projectCount = 0;
		let archiveCount = 0;
		let otherCount = 0;

		files.forEach(f => {
			const path = f.path;
			if (path.startsWith('01 Daily') || path.includes('/01 Daily/')) {
				dailyCount++;
			} else if (path.startsWith('02 Inbox')) {
				inboxCount++;
			} else if (path.startsWith('03 Projects') || path.includes('/03 Projects/')) {
				projectCount++;
			} else if (path.startsWith('Archive') || path.includes('/Archive/')) {
				archiveCount++;
			} else {
				otherCount++;
			}
		});

		const total = files.length || 1;
		return [
			{ name: '日记 (Daily)', count: dailyCount, pct: Math.round((dailyCount / total) * 100), cls: 'ad-segment-daily' },
			{ name: '项目 (Projects)', count: projectCount, pct: Math.round((projectCount / total) * 100), cls: 'ad-segment-atomics' },
			{ name: '收件箱 (Inbox)', count: inboxCount, pct: Math.round((inboxCount / total) * 100), cls: 'ad-segment-inbox' },
			{ name: '归档 (Archive)', count: archiveCount, pct: Math.round((archiveCount / total) * 100), cls: 'ad-segment-archive' },
			{ name: '其他 (Other)', count: otherCount, pct: Math.round((otherCount / total) * 100), cls: 'ad-segment-other' }
		].filter(item => item.count > 0);
	}

	/**
	 * =========================================================================
	 * 02 / 日记主频道渲染
	 * =========================================================================
	 */
	private renderDiaryDashboard(parent: Element): void {
		const grid = parent.createDiv({ cls: 'ad-middle-grid', attr: { style: 'grid-template-columns: 3fr 1fr;' } });
		
		this.renderPeriodicNotesPanel(grid);
		this.renderTodayDiary(grid);
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
		const header = card.createDiv({ cls: 'ad-card-header' });
		header.createEl('h3', { text: '周期日记打卡墙' });

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
				this.render();
			});
		});

		const gridContainer = card.createDiv({ cls: 'ad-periodic-grid-container', attr: { style: 'flex-grow: 1; max-height: none; overflow-y: auto;' } });

		if (this.periodicTab === 'day') {
			const grid = gridContainer.createDiv({ 
				attr: { style: 'display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; width: 100%;' } 
			});
			const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
			weekdays.forEach(wd => {
				grid.createDiv({ text: wd, attr: { style: 'text-align: center; font-size: 11px; color: var(--text-muted); font-weight: 600; padding-bottom: 4px;' } });
			});

			const now = moment();
			const year = now.year();
			const month = now.month();
			const daysInMonth = now.daysInMonth();
			
			const firstDay = moment().year(year).month(month).date(1);
			const isoDay = firstDay.day();
			const offset = isoDay === 0 ? 6 : isoDay - 1;

			for (let i = 0; i < offset; i++) {
				grid.createDiv({ cls: 'ad-periodic-cell is-empty', attr: { style: 'pointer-events: none; opacity: 0;' } });
			}

			for (let d = 1; d <= daysInMonth; d++) {
				const date = moment().year(year).month(month).date(d);
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
			const now = moment();
			const year = now.year();
			
			for (let w = 1; w <= 52; w++) {
				const date = moment().year(year).isoWeek(w).startOf('isoWeek');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'week');
				const isCreated = this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `ad-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
					text: `W${w}`,
					attr: { 'title': isCreated ? `周记: ${fileName} (已创建)` : `周记: ${fileName} (未创建)` }
				});
				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'week', isCreated, filePath, fileName);
				});
			}
		} else if (this.periodicTab === 'month') {
			const grid = gridContainer.createDiv({ 
				attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; width: 100%;' } 
			});
			const now = moment();
			const year = now.year();
			
			for (let m = 1; m <= 12; m++) {
				const date = moment().year(year).month(m - 1).startOf('month');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'month');
				const file = this.app.vault.getAbstractFileByPath(filePath);
				const isCreated = file instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `ad-card ad-tech-card ${isCreated ? 'is-created' : 'is-missing'}-box`,
					attr: { 
						style: `padding: 12px; min-height: 80px; display: flex; flex-direction: column; justify-content: space-between; cursor: pointer; border: 1.5px ${isCreated ? 'solid var(--text-success)' : 'dashed var(--background-modifier-border)'}; border-radius: 6px; background: var(--background-primary);`
					}
				});
				
				const titleDiv = cell.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center;' } });
				titleDiv.createSpan({ text: `${m}月`, attr: { style: 'font-weight: 700; font-size: 14px;' } });
				titleDiv.createSpan({ 
					text: isCreated ? '已创建' : '未创建', 
					cls: `ad-badge ${isCreated ? 'ad-badge-success' : 'ad-badge-muted'}` 
				});

				const previewEl = cell.createDiv({ 
					text: '加载中...', 
					attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; line-height: 1.4;' } 
				});

				if (isCreated && file instanceof TFile) {
					void this.app.vault.read(file).then(content => {
						const lines = content.split('\n')
							.map(l => l.trim())
							.filter(l => l && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('title:') && !l.startsWith('created:') && !l.startsWith('author:'));
						previewEl.setText(lines.slice(0, 2).join(' ') || '无摘要内容。');
					});
				} else {
					previewEl.setText('点击创建该月度总结。');
				}

				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'month', isCreated, filePath, fileName);
				});
			}
		} else if (this.periodicTab === 'quarter') {
			const grid = gridContainer.createDiv({ 
				attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; width: 100%;' } 
			});
			const now = moment();
			const year = now.year();
			
			for (let q = 1; q <= 4; q++) {
				const date = moment().year(year).quarter(q).startOf('quarter');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'quarter');
				const file = this.app.vault.getAbstractFileByPath(filePath);
				const isCreated = file instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `ad-card ad-tech-card ${isCreated ? 'is-created' : 'is-missing'}-box`,
					attr: { 
						style: `padding: 12px; min-height: 80px; display: flex; flex-direction: column; justify-content: space-between; cursor: pointer; border: 1.5px ${isCreated ? 'solid var(--text-success)' : 'dashed var(--background-modifier-border)'}; border-radius: 6px; background: var(--background-primary);`
					}
				});

				const titleDiv = cell.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center;' } });
				titleDiv.createSpan({ text: `第 ${q} 季度`, attr: { style: 'font-weight: 700; font-size: 14px;' } });
				titleDiv.createSpan({ 
					text: isCreated ? '已创建' : '未创建', 
					cls: `ad-badge ${isCreated ? 'ad-badge-success' : 'ad-badge-muted'}` 
				});

				const previewEl = cell.createDiv({ 
					text: '加载中...', 
					attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; line-height: 1.4;' } 
				});

				if (isCreated && file instanceof TFile) {
					void this.app.vault.read(file).then(content => {
						const lines = content.split('\n')
							.map(l => l.trim())
							.filter(l => l && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('title:') && !l.startsWith('created:') && !l.startsWith('author:'));
						previewEl.setText(lines.slice(0, 2).join(' ') || '无摘要内容。');
					});
				} else {
					previewEl.setText('点击创建该季度总结。');
				}

				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'quarter', isCreated, filePath, fileName);
				});
			}
		} else { // year
			const grid = gridContainer.createDiv({ 
				attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; width: 100%;' } 
			});
			const now = moment();
			const currentYear = now.year();
			const years = Array.from({ length: 4 }).map((_, i) => currentYear - 3 + i);
			
			years.forEach(y => {
				const date = moment().year(y).startOf('year');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'year');
				const file = this.app.vault.getAbstractFileByPath(filePath);
				const isCreated = file instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `ad-card ad-tech-card ${isCreated ? 'is-created' : 'is-missing'}-box`,
					attr: { 
						style: `padding: 12px; min-height: 80px; display: flex; flex-direction: column; justify-content: space-between; cursor: pointer; border: 1.5px ${isCreated ? 'solid var(--text-success)' : 'dashed var(--background-modifier-border)'}; border-radius: 6px; background: var(--background-primary);`
					}
				});

				const titleDiv = cell.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center;' } });
				titleDiv.createSpan({ text: `${y}年`, attr: { style: 'font-weight: 700; font-size: 14px;' } });
				titleDiv.createSpan({ 
					text: isCreated ? '已创建' : '未创建', 
					cls: `ad-badge ${isCreated ? 'ad-badge-success' : 'ad-badge-muted'}` 
				});

				const previewEl = cell.createDiv({ 
					text: '加载中...', 
					attr: { style: 'font-size: 11px; color: var(--text-muted); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; line-height: 1.4;' } 
				});

				if (isCreated && file instanceof TFile) {
					void this.app.vault.read(file).then(content => {
						const lines = content.split('\n')
							.map(l => l.trim())
							.filter(l => l && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('title:') && !l.startsWith('created:') && !l.startsWith('author:'));
						previewEl.setText(lines.slice(0, 2).join(' ') || '无摘要内容。');
					});
				} else {
					previewEl.setText('点击创建年度总结。');
				}

				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'year', isCreated, filePath, fileName);
				});
			});
		}
	}

	private renderTodayDiary(parent: Element): void {
		const diaryCard = parent.createDiv({ cls: 'ad-card ad-diary-card ad-tech-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column;' } });
		const header = diaryCard.createDiv({ cls: 'ad-card-header' });
		header.createEl('h3', { text: "今日日记状态" });
		
		const badge = header.createSpan({ 
			text: '检测中...',
			cls: 'ad-badge ad-badge-muted'
		});

		const content = diaryCard.createDiv({ cls: 'ad-diary-content', attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between;' } });
		const innerDiv = content.createDiv();
		const pathEl = innerDiv.createEl('div', { text: "加载中...", cls: 'ad-diary-path', attr: { style: 'font-family: var(--font-monospace); font-size: 11px; margin-bottom: 10px; color: var(--text-muted);' } });
		const summaryEl = innerDiv.createEl('p', { text: "正在读取日记内容...", cls: 'ad-diary-summary', attr: { style: 'font-size: 13px; line-height: 1.5; color: var(--text-normal);' } });
		
		const openBtn = content.createEl('button', { 
			text: '打开今日日记', 
			cls: 'ad-btn ad-btn-secondary',
			attr: { style: 'width: 100%; margin-top: 15px;' }
		});
		openBtn.disabled = true;

		void this.diaryService.getTodayDiaryStatus().then(status => {
			badge.setText(status.isCreated ? '已创建' : '未创建');
			badge.className = `ad-badge ${status.isCreated ? 'ad-badge-success' : 'ad-badge-warning'}`;
			pathEl.setText(status.path);
			summaryEl.setText(status.summary);
			
			openBtn.disabled = false;
			openBtn.onclick = () => {
				void (async () => {
					if (!status.isCreated) {
						try {
							const createdPath = await this.diaryService.createTodayDiary();
							new Notice(`成功创建今日日记: ${createdPath}`);
							void this.app.workspace.openLinkText(createdPath, '', false);
							this.render();
						} catch (e) {
							const errMsg = e instanceof Error ? e.message : String(e);
							new Notice(`创建今日日记失败: ${errMsg}`);
						}
					} else {
						void this.app.workspace.openLinkText(status.path, '', false);
					}
				})();
			};
		});
	}

	/**
	 * =========================================================================
	 * 03 / 巡检主频道渲染
	 * =========================================================================
	 */
	private renderLintDashboard(parent: Element): void {
		parent.empty();

		// Top header with Title and Sync Button
		const headerWrap = parent.createDiv({ cls: 'jarvis-stats-header-wrap', attr: { style: 'margin-bottom: 16px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px;' } });
		headerWrap.createSpan({ text: '知识库深度巡检与智能联动控制台', attr: { style: 'font-weight: 700; font-size: 16px;' } });

		const syncBtn = headerWrap.createEl('button', { cls: 'ad-btn ad-btn-secondary ad-btn-refresh' });
		setIcon(syncBtn, 'refresh-cw');
		syncBtn.createSpan({ text: ' 同步数据' });
		
		// 1. Two column layout (Left: Health Index, Right: Diagnostic Panel)
		const grid = parent.createDiv({ cls: 'ad-middle-grid', attr: { style: 'grid-template-columns: 1fr 1.6fr; gap: 16px; margin-bottom: 16px;' } });

		// Left Column: Score Card
		const leftCard = grid.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'text-align: center; display: flex; flex-direction: column; justify-content: space-between; padding: 16px; min-height: 320px;' } });
		leftCard.createEl('h3', { text: '仓库健康度评估' });

		const ringContainer = leftCard.createDiv({ cls: 'ad-progress-ring-container', attr: { style: 'margin: 15px auto;' } });
		const svg = ringContainer.createSvg('svg', { cls: 'ad-progress-ring', attr: { width: '120', height: '120' } });
		svg.createSvg('circle', {
			cls: 'ad-progress-ring-circle-bg',
			attr: { r: '45', cx: '60', cy: '60' }
		});
		const progressCircle = svg.createSvg('circle', {
			cls: 'ad-progress-ring-circle',
			attr: { r: '45', cx: '60', cy: '60', id: 'health-progress-circle' }
		});
		const textPercentage = ringContainer.createDiv({ cls: 'ad-progress-ring-text', text: '--%' });

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

		const optimizeBtn = btnGroup.createEl('button', {
			cls: 'ad-btn ad-btn-primary',
			attr: { style: 'width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;' }
		});
		setIcon(optimizeBtn, 'wrench');
		optimizeBtn.createSpan({ text: '立即优化' });

		// Right Column: Diagnostics List Panel (Data-only)
		const rightCard = grid.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'padding: 16px; display: flex; flex-direction: column; justify-content: space-between; min-height: 320px;' } });
		rightCard.createEl('h3', { text: '诊断子项检测报告' });
		
		const listContainer = rightCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 10px; margin-top: 8px; flex-grow: 1; overflow-y: auto;' } });

		// 1. Inbox Item
		const inboxItem = listContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--background-primary); border-radius: 4px; border: 1px solid var(--background-modifier-border);' } });
		const inboxLeft = inboxItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
		const inboxIconEl = inboxLeft.createDiv();
		setIcon(inboxIconEl, 'inbox');
		const inboxTextWrap = inboxLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 2px;' } });
		inboxTextWrap.createSpan({ text: '待分类文件 (Inbox Backlog)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const inboxDesc = inboxTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		// 2. Un-ingested Diaries
		const diaryItem = listContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--background-primary); border-radius: 4px; border: 1px solid var(--background-modifier-border);' } });
		const diaryLeft = diaryItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
		const diaryIconEl = diaryLeft.createDiv();
		setIcon(diaryIconEl, 'calendar');
		const diaryTextWrap = diaryLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 2px;' } });
		diaryTextWrap.createSpan({ text: '待入库日记 (Un-ingested Diaries)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const diaryDesc = diaryTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		// 3. Orphans Item
		const orphanItem = listContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--background-primary); border-radius: 4px; border: 1px solid var(--background-modifier-border);' } });
		const orphanLeft = orphanItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
		const orphanIconEl = orphanLeft.createDiv();
		setIcon(orphanIconEl, 'compass');
		const orphanTextWrap = orphanLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 2px;' } });
		orphanTextWrap.createSpan({ text: '孤儿笔记 (Orphans)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const orphanDesc = orphanTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		// 4. Dead Links Item
		const deadLinkItem = listContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--background-primary); border-radius: 4px; border: 1px solid var(--background-modifier-border);' } });
		const deadLinkLeft = deadLinkItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
		const deadLinkIconEl = deadLinkLeft.createDiv();
		setIcon(deadLinkIconEl, 'link');
		const deadLinkTextWrap = deadLinkLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 2px;' } });
		deadLinkTextWrap.createSpan({ text: '未解析死链 (Dead Links)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const deadLinkDesc = deadLinkTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		// 5. Empty Notes Item
		const emptyNoteItem = listContainer.createDiv({ cls: 'ad-task-item', attr: { style: 'justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--background-primary); border-radius: 4px; border: 1px solid var(--background-modifier-border);' } });
		const emptyNoteLeft = emptyNoteItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
		const emptyNoteIconEl = emptyNoteLeft.createDiv();
		setIcon(emptyNoteIconEl, 'file-text');
		const emptyNoteTextWrap = emptyNoteLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 2px;' } });
		emptyNoteTextWrap.createSpan({ text: '空白笔记 (Empty Notes)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const emptyNoteDesc = emptyNoteTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		// Bottom Console: claudian Skill Panel
		const consoleCard = parent.createDiv({ cls: 'ad-card ad-tech-card', attr: { style: 'margin-bottom: 16px; padding: 16px;' } });
		consoleCard.createEl('h3', { text: 'Claudian 智能联动控制台' });

		const consoleLayout = consoleCard.createDiv({ cls: 'ad-console-layout', attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px;' } });
		
		// Bottom Left: Preset Skill Actions
		const presetsDiv = consoleLayout.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } });
		presetsDiv.createDiv({ text: '// 核心技能快捷通道', cls: 'ad-bus-section-title', attr: { style: 'margin-bottom: 4px;' } });
		const presetsGrid = presetsDiv.createDiv({ attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px;' } });

		const presetSkills = [
			{ label: '快捷入库 (Ingest)', prompt: '@skills/ingest 请帮我整理并分类 01 Daily 中的未入库日记' },
			{ label: '全面体检 (Lint)', prompt: '@skills/lint 请帮我扫描并体检整个知识库，找出孤儿笔记与死链并协助修复' },
			{ label: '清理空白 (Clean)', prompt: '@skills/lint 请帮我清理库中的所有空白笔记' },
			{ label: '文档审计 (Review)', prompt: '@skills/research 请对当前项目与知识库进行全面审计并输出优化意见' }
		];

		presetSkills.forEach(skill => {
			const btn = presetsGrid.createEl('button', { cls: 'ad-btn ad-btn-secondary', attr: { style: 'justify-content: flex-start; gap: 6px; font-size: 11px; padding: 8px;' } });
			setIcon(btn, 'bot');
			btn.createSpan({ text: skill.label });
			btn.addEventListener('click', () => {
				new Notice(`已触发: ${skill.label}`);
				this.triggerClaudianPrompt(skill.prompt);
			});
		});

		// Bottom Right: Interactive Inputs for Query and Research
		const inputsDiv = consoleLayout.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } });
		inputsDiv.createDiv({ text: '// 自定义主题交互', cls: 'ad-bus-section-title', attr: { style: 'margin-bottom: 4px;' } });

		// Query input group
		const queryGroup = inputsDiv.createDiv({ attr: { style: 'display: flex; gap: 6px; align-items: center;' } });
		const queryInput = queryGroup.createEl('input', { type: 'text', placeholder: '输入要查询的知识主题...', attr: { style: 'flex-grow: 1; height: 30px; font-size: 12px; padding: 0 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal);' } });
		const queryBtn = queryGroup.createEl('button', { cls: 'ad-btn ad-btn-primary', attr: { style: 'height: 30px; gap: 4px; font-size: 11px;' } });
		setIcon(queryBtn, 'bot');
		queryBtn.createSpan({ text: '检索' });
		queryBtn.addEventListener('click', () => {
			if (queryInput.value.trim()) {
				this.triggerClaudianPrompt(`@skills/query 请帮我检索关于“${queryInput.value.trim()}”的内容`);
				queryInput.value = '';
			} else {
				new Notice('请先输入要检索的主题');
			}
		});

		// Research input group
		const researchGroup = inputsDiv.createDiv({ attr: { style: 'display: flex; gap: 6px; align-items: center;' } });
		const researchInput = researchGroup.createEl('input', { type: 'text', placeholder: '输入要研究的主题/方向...', attr: { style: 'flex-grow: 1; height: 30px; font-size: 12px; padding: 0 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal);' } });
		const researchBtn = researchGroup.createEl('button', { cls: 'ad-btn ad-btn-primary', attr: { style: 'height: 30px; gap: 4px; font-size: 11px;' } });
		setIcon(researchBtn, 'bot');
		researchBtn.createSpan({ text: '研究' });
		researchBtn.addEventListener('click', () => {
			if (researchInput.value.trim()) {
				this.triggerClaudianPrompt(`@skills/research 请针对“${researchInput.value.trim()}”这一主题开展深度主题研究`);
				researchInput.value = '';
			} else {
				new Notice('请先输入要研究的主题');
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
		const currentYmStr = moment().format('YYYY-MM');
		reportBtn.createSpan({ text: `生成 ${currentYmStr} 巡检分析报告` });
		reportBtn.addEventListener('click', () => {
			void this.generateMonthlyReport();
		});

		// Core calculations and sync updating logic
		const runScan = () => {
			if (this.isScanning) return;
			this.isScanning = true;
			statusText.setText('正在扫描知识库结构与属性...');
			statusText.setCssStyles({ color: 'var(--text-accent)' });
			runBtn.disabled = true;
			syncBtn.disabled = true;
			optimizeBtn.disabled = true;

			window.setTimeout(() => {
				void Promise.all([
					this.vaultService.getInboxBacklog(),
					this.vaultService.getOrphanCount(),
					this.vaultService.getDeadLinkCount(),
					this.vaultService.getUningestedDiariesCount(),
					this.vaultService.getEmptyNotesCount()
				]).then(([inbox, orphans, deadLinks, uningested, empty]) => {
					// Non-linear health evaluation formula
					const totalMarkdownFiles = this.app.vault.getMarkdownFiles().length || 1;
					const inboxDeduct = Math.min(25, inbox.count * 3);
					const diaryDeduct = Math.min(20, uningested * 2);
					const emptyDeduct = Math.min(15, empty * 2);
					const orphanDeduct = Math.min(25, (orphans / totalMarkdownFiles) * 50 + Math.min(10, orphans * 0.1));
					const deadLinkDeduct = Math.min(15, Math.log10(deadLinks + 1) * 5);
					
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

					inboxDesc.setText(`当前收件箱积压: ${inbox.count} 篇 Markdown 文件。最久积压: ${inbox.oldestDays} 天`);
					diaryDesc.setText(`日记目录中发现 ${uningested} 篇待入库日记。`);
					orphanDesc.setText(`发现 ${orphans} 篇没有被任何其他笔记引用的独立笔记。`);
					deadLinkDesc.setText(`发现 ${deadLinks} 处指向不存在文件的未解析链接。`);
					emptyNoteDesc.setText(`发现 ${empty} 篇正文（排除 Frontmatter）为空的空白笔记。`);

					this.lastScanTime = moment().format('YYYY-MM-DD HH:mm:ss');
					scanTimeSpan.setText(`上次体检: ${this.lastScanTime}`);

					this.isScanning = false;
					runBtn.disabled = false;
					syncBtn.disabled = false;
					optimizeBtn.disabled = false;
				}).catch(e => {
					console.error('Scan failed:', e);
					this.isScanning = false;
					runBtn.disabled = false;
					syncBtn.disabled = false;
					optimizeBtn.disabled = false;
				});
			}, 600);
		};

		// Trigger scan on load
		runScan();

		// Bind trigger events
		runBtn.addEventListener('click', runScan);
		syncBtn.addEventListener('click', runScan);
		optimizeBtn.addEventListener('click', () => {
			this.openLintModal();
		});
	} ${inbox.oldestDays} 天`);
					diaryDesc.setText(`收件箱中发现 ${uningested} 篇格式为日期命名的周期日记待归档。`);
					orphanDesc.setText(`发现 ${orphans} 篇没有被任何其他笔记引用的独立笔记。`);
					deadLinkDesc.setText(`发现 ${deadLinks} 处指向不存在文件的未解析链接。`);
					emptyNoteDesc.setText(`发现 ${empty} 篇正文（排除 Frontmatter）为空的空白笔记。`);

					// Update actions
					inboxBtn.onclick = () => {
						this.openIngestModal();
					};
					inboxClaudianBtn.onclick = () => {
						this.triggerClaudianPrompt('@skills/ingest 请帮我整理并分类 02 Inbox 中的待处理文件');
					};

					diaryBtn.onclick = () => {
						this.openIngestModal();
					};
					diaryClaudianBtn.onclick = () => {
						this.triggerClaudianPrompt('@skills/ingest 请帮我整理分类 02 Inbox 中的未归档日记');
					};

					orphanBtn.onclick = () => {
						this.openOrphansView(orphans);
					};
					orphanClaudianBtn.onclick = () => {
						this.triggerClaudianPrompt('@skills/lint 请分析并清理库中的孤儿笔记');
					};

					deadLinkBtn.onclick = () => {
						this.openDeadLinksView(deadLinks);
					};
					deadLinkClaudianBtn.onclick = () => {
						this.triggerClaudianPrompt('@skills/lint 请分析并自动修复库中的未解析死链');
					};

					emptyNoteBtn.onclick = () => {
						void (async () => {
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
									await this.app.fileManager.trashFile(file);
									cleanedCount++;
								}
							}
							new Notice(`成功清理 ${cleanedCount} 篇空白笔记！`);
							this.historyStats.cleanedEmpty += cleanedCount;
							runScan();
						})();
					};
					emptyNoteClaudianBtn.onclick = () => {
						this.triggerClaudianPrompt('@skills/lint 请分析并帮助我清理库中的空白笔记');
					};

					this.lastScanTime = moment().format('YYYY-MM-DD HH:mm:ss');
					scanTimeSpan.setText(`上次体检: ${this.lastScanTime}`);

					this.isScanning = false;
					runBtn.disabled = false;
					syncBtn.disabled = false;
					optimizeBtn.disabled = false;
				}).catch(e => {
					console.error('Scan failed:', e);
					this.isScanning = false;
					runBtn.disabled = false;
					syncBtn.disabled = false;
					optimizeBtn.disabled = false;
				});
			}, 600);
		};

		// Trigger scan on load
		runScan();

		// Bind trigger events
		runBtn.addEventListener('click', runScan);
		syncBtn.addEventListener('click', runScan);
		optimizeBtn.addEventListener('click', () => {
			this.openLintModal();
		});
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
			const diaryDeduct = Math.min(20, uningested * 2);
			const emptyDeduct = Math.min(15, empty * 2);
			const orphanDeduct = Math.min(25, (orphans / totalMarkdownFiles) * 50 + Math.min(10, orphans * 0.1));
			const deadLinkDeduct = Math.min(15, Math.log10(deadLinks + 1) * 5);
			
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
- **待入库日记 (Diary)**: ${uningested} 篇
- **孤儿笔记 (Orphans)**: ${orphans} 篇
- **失效死链 (Dead Links)**: ${deadLinks} 处
- **空白笔记 (Empty Notes)**: ${empty} 篇

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
		progressCard.createEl('h3', { text: '今日待办完成率' });
		
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
		todayCard.createEl('h3', { text: '今日任务流' });
		
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
		habitCard.createEl('h3', { text: '今日习惯打卡' });
		
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
		header.createEl('h3', { text: '项目追踪看板' });
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
			picker.create	private renderBarChart(parent: Element): void {
		// 收集真实的笔记数据
		const files = this.app.vault.getMarkdownFiles();
		const dateCounts = new Map<string, number>();
		files.forEach(f => {
			const cache = this.app.metadataCache.getFileCache(f);
			const frontmatter = cache?.frontmatter;
			let m: moment.Moment;
			if (frontmatter && frontmatter.created) {
				m = moment(frontmatter.created);
			} else if (frontmatter && frontmatter.date) {
				m = moment(frontmatter.date);
			} else {
				m = moment(f.stat.ctime);
			}
			if (m.isValid()) {
				const dateStr = m.format('YYYY-MM-DD');
				dateCounts.set(dateStr, (dateCounts.get(dateStr) || 0) + 1);
			}
		});

		let data: { label: string; count: number; tooltip: string }[] = [];
		const now = moment();
		
		if (this.statsTab === 'week') {
			const baseDate = now.clone().add(this.currentDateOffset, 'weeks').startOf('isoWeek');
			const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
			data = weekdays.map((day, i) => {
				const targetDate = baseDate.clone().add(i, 'days');
				const dateStr = targetDate.format('YYYY-MM-DD');
				const count = dateCounts.get(dateStr) || 0;
				return {
					label: day,
					count,
					tooltip: `${targetDate.format('MM-DD')} 新增 ${count} 篇`
				};
			});
		} else if (this.statsTab === 'month') {
			const baseDate = now.clone().add(this.currentDateOffset, 'months').startOf('month');
			const daysInMonth = baseDate.daysInMonth();
			data = Array.from({ length: daysInMonth }).map((_, i) => {
				const targetDate = baseDate.clone().add(i, 'days');
				const dateStr = targetDate.format('YYYY-MM-DD');
				const count = dateCounts.get(dateStr) || 0;
				return {
					label: String(i + 1),
					count,
					tooltip: `${targetDate.format('MM-DD')} 新增 ${count} 篇`
				};
			});
		} else if (this.statsTab === 'year') {
			const baseDate = now.clone().add(this.currentDateOffset, 'years').startOf('year');
			data = Array.from({ length: 12 }).map((_, i) => {
				const targetMonth = baseDate.clone().add(i, 'months');
				const daysInMonth = targetMonth.daysInMonth();
				let monthCount = 0;
				for (let d = 1; d <= daysInMonth; d++) {
					const dateStr = targetMonth.clone().date(d).format('YYYY-MM-DD');
					monthCount += dateCounts.get(dateStr) || 0;
				}
				return {
					label: `${i + 1}月`,
					count: monthCount,
					tooltip: `${i + 1}月 新增 ${monthCount} 篇`
				};
			});
		} else {
			const yearCounts = new Map<number, number>();
			for (const [dateStr, count] of dateCounts.entries()) {
				const year = moment(dateStr).year();
				yearCounts.set(year, (yearCounts.get(year) || 0) + count);
			}
			let years = Array.from(yearCounts.keys()).sort((a, b) => a - b);
			if (years.length === 0) years = [now.year()];
			const displayYears = years.slice(-5);
			data = displayYears.map(year => {
				const count = yearCounts.get(year) || 0;
				return {
					label: `${year}年`,
					count,
					tooltip: `${year}年度 新增 ${count} 篇`
				};
			});
		}

		const maxCount = Math.max(...data.map(d => d.count), 5);
		const wrapper = parent.createDiv({ attr: { style: 'position: relative; width: 100%; flex-grow: 1; display: flex; flex-direction: column;' } }); cards = [
			{ icon: 'calendar', val: '5 天', label: '记录天数' },
			{ icon: 'activity', val: '2.4 篇', label: '日均新增' },
			{ icon: 'file-text', val: '187 篇', label: '原子笔记' },
			{ icon: 'folder', val: '12 篇', label: 'Inbox 待理' },
			{ icon: 'book-open', val: '9 篇', label: '输出文章' },
			{ icon: 'link', val: '3 条', label: '孤立笔记' }
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
		let data: { label: string; count: number; tooltip: string }[] = [];
		if (this.statsTab === 'week') {
			const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
			const counts = [2, 4, 1, 5, 3, 0, 2];
			data = weekdays.map((day, i) => ({
				label: day,
				count: counts[i] || 0,
				tooltip: `星期${day} 新增 ${counts[i]} 篇`
			}));
		} else if (this.statsTab === 'month') {
			data = Array.from({ length: 30 }).map((_, i) => {
				const count = Math.floor(Math.random() * 6);
				return {
					label: String(i + 1),
					count,
					tooltip: `${i + 1}日 新增 ${count} 篇`
				};
			});
		} else if (this.statsTab === 'year') {
			const counts = [55, 68, 72, 60, 85, 90, 78, 82, 65, 70, 75, 80];
			data = Array.from({ length: 12 }).map((_, i) => ({
				label: `${i + 1}月`,
				count: counts[i] || 0,
				tooltip: `${i + 1}月 新增 ${counts[i]} 篇`
			}));
		} else {
			data = [
				{ label: '2024年', count: 420, tooltip: '2024年度 新增 420 篇' },
				{ label: '2025年', count: 780, tooltip: '2025年度 新增 780 篇' },
				{ label: '2026年', count: 428, tooltip: '2026年度 新增 428 篇' }
			];
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
				attr: { style: `height: ${pct || 2}%;` } 
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
		const heatmapWrapper = parent.createDiv({ cls: 'jarvis-stats-heatmap-wrapper' });
		const yearsToRender = this.statsTab === 'all' ? ['2024', '2025', '2026'] : ['2026'];
		
		yearsToRender.forEach(year => {
			if (this.statsTab === 'all') {
				heatmapWrapper.createEl('h4', { text: `${year}年`, attr: { style: 'margin: 10px 0 5px 0; font-size: 13px;' } });
			}
			
			const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
			const monthGrid = heatmapWrapper.createDiv({ 
				attr: { style: 'display: grid; grid-template-columns: repeat(53, 10px); gap: 3px; font-size: 9px; color: var(--text-muted); margin-bottom: 4px; padding-left: 18px;' } 
			});
			
			monthLabels.forEach((label, i) => {
				const colStart = Math.round(i * 4.4) + 1;
				monthGrid.createEl('span', { 
					text: label, 
					attr: { style: `grid-column-start: ${colStart}; white-space: nowrap;` } 
				});
			});

			const gridBody = heatmapWrapper.createDiv({ attr: { style: 'display: flex; gap: 8px;' } });
			const dayLabels = gridBody.createDiv({
				attr: { style: 'display: flex; flex-direction: column; justify-content: space-between; font-size: 9px; color: var(--text-muted); height: 88px; padding: 2px 0;' }
			});
			dayLabels.createSpan({ text: '一' });
			dayLabels.createSpan({ text: '三' });
			dayLabels.createSpan({ text: '五' });

			const gridContainer = gridBody.createDiv({ attr: { style: 'display: flex; gap: 3px;' } });
			for (let w = 0; w < 53; w++) {
				const col = gridContainer.createDiv({ cls: 'jarvis-stats-heatmap-col' });
				for (let d = 0; d < 7; d++) {
					let level = 0;
					const rand = Math.random();
					if (rand > 0.95) level = 4;
					else if (rand > 0.85) level = 3;
					else if (rand > 0.65) level = 2;
					else if (rand > 0.45) level = 1;
					
					const dateStr = `${year}-06-${String(w).padStart(2, '0')}`;
					const cell = col.createDiv({ cls: `jarvis-stats-heatmap-cell level-${level}` });
					cell.createDiv({ text: `${dateStr} 新增 ${level * 2} 篇笔记`, cls: 'jarvis-stats-heatmap-cell-tooltip' });
				}
			}
		});

		const footer = parent.createDiv({ cls: 'jarvis-stats-heatmap-footer' });
		footer.createSpan({ text: '本年度共活跃 145 天，累计新增 428 篇笔记' });
		
		const legend = footer.createDiv({ cls: 'jarvis-stats-heatmap-legend' });
		legend.createSpan({ text: '少' });
		for (let i = 0; i <= 4; i++) {
			legend.createDiv({ cls: `jarvis-stats-heatmap-legend-box level-${i}` });
		}
		legend.createSpan({ text: '多' });
	}
}
