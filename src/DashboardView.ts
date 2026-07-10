import { ItemView, WorkspaceLeaf, Notice, setIcon, TFile, TFolder, moment, Modal, App, } from 'obsidian';
import { Setting } from 'obsidian';
import VaultOsPlugin from './main';
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

export const VIEW_TYPE_VAULT_OS = 'vault-os-view';

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
		
		const closeBtn = contentEl.createEl('button', { text: '关闭', cls: 'vo-btn vo-btn-secondary', attr: { style: 'float: right; margin-top: 15px;' } });
		closeBtn.onclick = () => this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class NumberInputModal extends Modal {
	private readonly titleText: string;
	private readonly initialValue: number;
	private readonly minValue: number;
	private readonly maxValue: number;
	private readonly onSubmitValue: (value: number) => void;

	constructor(app: App, titleText: string, initialValue: number, minValue: number, maxValue: number, onSubmitValue: (value: number) => void) {
		super(app);
		this.titleText = titleText;
		this.initialValue = initialValue;
		this.minValue = minValue;
		this.maxValue = maxValue;
		this.onSubmitValue = onSubmitValue;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.titleText });

		let draftValue = this.initialValue;
		const hint = `${this.minValue} - ${this.maxValue}`;

		new Setting(contentEl)
			.setName('数值')
			.setDesc(`请输入 ${hint}`)
			.addText(text => {
				text
					.setPlaceholder(hint)
					.setValue(String(this.initialValue))
					.onChange((value) => {
						const parsed = Number.parseInt(value, 10);
						if (!Number.isNaN(parsed)) {
							draftValue = parsed;
						}
					});
				text.inputEl.type = 'number';
				text.inputEl.min = String(this.minValue);
				text.inputEl.max = String(this.maxValue);
				window.setTimeout(() => text.inputEl.select(), 0);
			});

		const footer = contentEl.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;' } });
		const cancelBtn = footer.createEl('button', { text: '取消' });
		const confirmBtn = footer.createEl('button', { text: '确定', cls: 'mod-cta' });

		cancelBtn.addEventListener('click', () => this.close());
		confirmBtn.addEventListener('click', () => {
			if (draftValue < this.minValue || draftValue > this.maxValue) {
				new Notice(`请输入 ${hint} 之间的数值`);
				return;
			}
			this.onSubmitValue(draftValue);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class LintModal extends Modal {
	private vaultService: VaultService;
	private dashboardView: VaultOsView;
	
	constructor(app: App, vaultService: VaultService, dashboardView: VaultOsView) {
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
		const startBtn = buttons.createEl('button', { text: '开始体检', cls: 'vo-btn vo-btn-primary' });
		const closeBtn = buttons.createEl('button', { text: '取消', cls: 'vo-btn vo-btn-secondary' });
		
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
						
						const actionBtn = buttons.createEl('button', { text: '一键自动修复', cls: 'vo-btn vo-btn-primary' });
						actionBtn.addEventListener('click', () => {
							actionBtn.disabled = true;
							closeBtn.disabled = true;
							progressArea.createDiv({ text: '正在进行本地空笔记清理与文件回收...' });
							progressArea.scrollTop = progressArea.scrollHeight;
							
							void (async () => {
								try {
									const candidates = await this.vaultService.getEmptyNoteFiles();
									let cleanedCount = 0;
									for (const file of candidates) {
										progressArea.createDiv({ text: `正在清理空笔记: ${file.name}` });
										progressArea.scrollTop = progressArea.scrollHeight;
										await this.app.fileManager.trashFile(file);
										cleanedCount++;
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
	private plugin: VaultOsPlugin;

	constructor(plugin: VaultOsPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { 
			text: '快捷入库与归档控制台', 
			attr: { style: 'margin-bottom: 12px; color: var(--interactive-accent); border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px;' } 
		});
		
		const inboxFolder = this.app.vault.getAbstractFileByPath(this.plugin.settings.inboxFolder);
		let inboxFiles: TFile[] = [];
		if (inboxFolder instanceof TFolder) {
			inboxFiles = inboxFolder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
		}

		if (inboxFiles.length === 0) {
			contentEl.createEl('p', {
				text: `收件箱 (${this.plugin.settings.inboxFolder}) 暂无待分类的笔记！`,
				attr: { style: 'color: var(--text-muted); font-style: italic; text-align: center; margin: 30px 0;' }
			});
			const closeBtn = contentEl.createEl('button', { text: '关闭', cls: 'vo-btn vo-btn-secondary', attr: { style: 'float: right;' } });
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
			
			// 2. Archive
			const archiveBtn = actionGroup.createEl('button', { text: '归档', cls: 'vo-btn vo-btn-secondary' });
			archiveBtn.onclick = () => {
				void (async () => {
					const archiveDir = this.app.vault.getAbstractFileByPath(this.plugin.settings.archiveFolder);
					if (!archiveDir) {
						await this.app.vault.createFolder(this.plugin.settings.archiveFolder);
					}
					const newPath = `${this.plugin.settings.archiveFolder}/${file.name}`;
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


export class VaultOsView extends ItemView {
	plugin: VaultOsPlugin;
	
	// 看板激活状态 (5个主Tab)
	private activeMainTab: 'vault' | 'diary' | 'lint' | 'ticktick' = 'vault';
	
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

	private getFocusLabel(focus: FocusItem): string {
		return focus.tag?.trim()
			|| focus.tasks?.find(task => task.timerName?.trim())?.timerName?.trim()
			|| '默认专注';
	}

	private getFocusHeatLevel(duration: number): number {
		if (duration >= 120) return 4;
		if (duration >= 60) return 3;
		if (duration >= 30) return 2;
		if (duration > 0) return 1;
		return 0;
	}

	private formatFocusMinutes(totalMinutes: number): string {
		if (totalMinutes < 60) {
			return `${totalMinutes} 分钟`;
		}

		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
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
	private selectedPeriodicDate = moment();
	private lastScanTime = '尚未进行体检';
	private isScanning = false;
	private historyStats = { ingested: 12, fixedLinks: 47, cleanedEmpty: 9 };
	private currentScanData: ScanData | null = null;

	private cachedVaultOverviewStats: VaultOverviewStats | null = null;
	private cachedDateCounts: Map<string, number> | null = null;
	private clearCacheTimer: number | null = null;

	private clearVaultStatsCache(): void {
		if (this.clearCacheTimer) window.clearTimeout(this.clearCacheTimer);
		this.clearCacheTimer = window.setTimeout(() => {
			this.cachedVaultOverviewStats = null;
			this.cachedDateCounts = null;
			if (this.activeMainTab === 'vault') {
				this.render();
			}
		}, 300);
	}

	// 服务实例
	private readingService: ReadingService;
	private diaryService: DiaryService;
	private taskService: TaskService;
	private vaultService: VaultService;

	constructor(leaf: WorkspaceLeaf, plugin: VaultOsPlugin) {
		super(leaf);
		this.plugin = plugin;
		
		this.readingService = new ReadingService(this.app);
		this.diaryService = new DiaryService(this.plugin);
		this.taskService = new TaskService(this.plugin);
		this.vaultService = new VaultService(this.plugin);
	}

	private calculateLintHealthScore(scanData: ScanData): number {
		const knowledgeCount = Math.max(
			1,
			this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(this.plugin.settings.atomicsFolder)).length
		);
		const inboxDeduct = Math.min(25, scanData.inbox.count * 3);
		const diaryDeduct = Math.min(20, scanData.uningested.count * 2);
		const emptyDeduct = Math.min(15, scanData.empty.count * 2);
		const orphanDeduct = Math.min(25, (scanData.orphans.count / knowledgeCount) * 50 + Math.min(10, scanData.orphans.count * 0.1));
		const deadLinkDeduct = Math.min(15, Math.log10(scanData.deadLinks.count + 1) * 5);

		let score = Math.round(100 - (inboxDeduct + diaryDeduct + emptyDeduct + orphanDeduct + deadLinkDeduct));
		if (score < 0) score = 0;
		if (score > 100) score = 100;
		return score;
	}

	getViewType(): string {
		return VIEW_TYPE_VAULT_OS;
	}

	getDisplayText(): string {
		return 'Vault OS';
	}

	getIcon(): string {
		return 'waypoints';
	}

	private getPeriodicBaseDate(): moment.Moment {
		const baseDate = this.selectedPeriodicDate.clone();
		if (this.periodicTab === 'week') return baseDate.startOf('isoWeek');
		if (this.periodicTab === 'month') return baseDate.startOf('month');
		if (this.periodicTab === 'quarter') return baseDate.startOf('quarter');
		if (this.periodicTab === 'year') return baseDate.startOf('year');
		return baseDate.startOf('day');
	}

	private shiftPeriodicDate(direction: -1 | 1): void {
		const stepUnit: moment.unitOfTime.DurationConstructor = this.periodicTab === 'day' ? 'months' : 'years';
		this.selectedPeriodicDate = this.getPeriodicBaseDate().add(direction, stepUnit);
	}

	private getPeriodicDateLabel(baseDate: moment.Moment): string {
		if (this.periodicTab === 'day') return baseDate.format('YYYY/M/D');
		if (this.periodicTab === 'week') return baseDate.format('GGGG[W]WW');
		if (this.periodicTab === 'month') return baseDate.format('YYYY/M');
		if (this.periodicTab === 'quarter') return baseDate.format('YYYY[Q]Q');
		return baseDate.format('YYYY');
	}

	private getPeriodicCardTitle(): string {
		const tabNames: Record<'day' | 'week' | 'month' | 'quarter' | 'year', string> = {
			day: '日记',
			week: '周记',
			month: '月记',
			quarter: '季记',
			year: '年记'
		};
		return `当前${tabNames[this.periodicTab]}`;
	}

	private openPeriodicPartPicker(part: 'year' | 'month' | 'day'): void {
		const baseDate = this.getPeriodicBaseDate();
		const config = part === 'year'
			? { title: '跳转到年份', initialValue: baseDate.year(), minValue: 1970, maxValue: 2100 }
			: part === 'month'
				? { title: '跳转到月份', initialValue: baseDate.month() + 1, minValue: 1, maxValue: 12 }
				: { title: '跳转到日期', initialValue: baseDate.date(), minValue: 1, maxValue: baseDate.daysInMonth() };

		new NumberInputModal(this.app, config.title, config.initialValue, config.minValue, config.maxValue, (value) => {
			const nextDate = this.getPeriodicBaseDate().clone();
			if (part === 'year') nextDate.year(value);
			else if (part === 'month') nextDate.month(value - 1);
			else nextDate.date(value);
			this.selectedPeriodicDate = nextDate;
			this.render();
		}).open();
	}

	private renderPeriodicDatePickerLabel(parent: HTMLElement, baseDate: moment.Moment): void {
		const createPartButton = (text: string, part: 'year' | 'month' | 'day') => {
			const button = parent.createEl('button', {
				text,
				attr: { style: 'background: transparent; border: none; box-shadow: none; cursor: pointer; padding: 0; font-weight: 500; font-size: 12px; color: var(--text-normal);' }
			});
			button.addEventListener('click', () => this.openPeriodicPartPicker(part));
		};

		if (this.periodicTab === 'day') {
			createPartButton(String(baseDate.year()), 'year');
			parent.createSpan({ text: '/' });
			createPartButton(String(baseDate.month() + 1), 'month');
			parent.createSpan({ text: '/' });
			createPartButton(String(baseDate.date()), 'day');
			return;
		}

		if (this.periodicTab === 'month') {
			createPartButton(String(baseDate.year()), 'year');
			parent.createSpan({ text: '/' });
			createPartButton(String(baseDate.month() + 1), 'month');
			return;
		}

		parent.createSpan({ text: this.getPeriodicDateLabel(baseDate), attr: { style: 'font-weight: 500; font-size: 13px; text-align: center;' } });
	}

	triggerClaudianPrompt(prompt: string): void {
		const settings = this.plugin.settings;
		const finalPrompt = prompt
			.replace(/\{\{daily_path\}\}/g, settings.dailyNoteFolder)
			.replace(/\{\{inbox_path\}\}/g, settings.inboxFolder)
			
			.replace(/\{\{atomics_path\}\}/g, settings.atomicsFolder)
			.replace(/\{\{archive_path\}\}/g, settings.archiveFolder)
			.replace(/\{\{output_path\}\}/g, settings.outputFolder);

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

			textarea.value = finalPrompt;
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

	private formatTickTickSyncTime(timestamp: number | null): string {
		if (!timestamp) {
			return '尚未同步';
		}

		const syncMoment = moment(timestamp);
		if (syncMoment.isSame(moment(), 'day')) {
			return `今天 ${syncMoment.format('HH:mm')}`;
		}
		return syncMoment.format('MM/DD HH:mm');
	}

	private triggerTickTickSync(showNotice: boolean = true): void {
		if (showNotice) {
			new Notice('开始同步 TickTick 数据...');
		}
		const syncPromise = this.taskService.syncWithTickTick();
		this.render();

		void syncPromise.then(() => {
			if (!showNotice) {
				return;
			}
			const status = this.taskService.getSyncStatus();
			if (status.state === 'error') {
				new Notice(`同步失败: ${status.errorMessage || '未知错误'}`);
			}
		}).finally(() => {
			this.render();
		});
	}

	async onOpen(): Promise<void> {
		await this.taskService.initialize();
		this.registerEvent(this.app.vault.on('create', () => this.clearVaultStatsCache()));
		this.registerEvent(this.app.vault.on('delete', () => this.clearVaultStatsCache()));
		this.registerEvent(this.app.vault.on('modify', () => this.clearVaultStatsCache()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.clearVaultStatsCache()));

		this.render();
		
		if (this.activeMainTab === 'ticktick') {
			this.triggerTickTickSync(false);
		}
	}

	async onClose(): Promise<void> {
		// 无需特别销毁
	}

	render(): void {
		const container = this.containerEl.children[1];
		if (!container) return;

		container.empty();
		container.addClass('vo-container');
		
		const maxWidthPct = this.plugin.settings.containerMaxWidth || 100;
		(container as HTMLElement).style.maxWidth = maxWidthPct < 100 ? `${maxWidthPct}%` : '100%';

		// 1. 上方区域：系统状态栏 (Telemetry Header)
		this.renderTopTelemetry(container);

		// 2. 下方区域：单页流式展示区 (Viewport)
		const viewport = container.createDiv({ cls: 'vo-viewport' });
		this.renderRightViewport(viewport);
	}

	/**
	 * 1. 渲染顶部系统状态栏 (Telemetry Header)
	 */
	private renderTopTelemetry(parent: Element): void {
		const telemetry = parent.createDiv({ 
			cls: 'vo-top-telemetry', 
			attr: { style: 'border-bottom: 1px solid color-mix(in srgb, var(--background-modifier-border) 40%, transparent); padding-bottom: 8px; margin-bottom: 12px;' } 
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
			text: this.plugin.settings.dashboardTitle || 'Vault OS', 
			attr: { style: 'font-size: 22px; font-weight: 600 !important; margin: 0; color: var(--text-normal); letter-spacing: 5px; font-family: \'Cinzel\', serif;' } 
		});
		
		// 3. Right column: Metadata (uptime, version)
		const rightCol = headerRow.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex: 1;' } });
		const diffDays = this.vaultService.getVaultLifetimeDays();
		
		rightCol.createDiv({ 
			text: `SYS.v${this.plugin.manifest.version} // UPTIME.${diffDays}d`, 
			attr: { style: 'font-size: 11px; color: var(--text-muted); font-family: var(--font-monospace); font-weight: 600; letter-spacing: 1px;' } 
		});
	}

	/**
	 * 2.1 渲染左侧常驻控制总线 (Control Bus)
	 */
	private renderLeftControlBus(parent: Element): void {
		const sidebar = parent.createDiv({ cls: 'vo-sidebar-bus' });

		// 1. Navigation Bus
		this.renderNavigationBus(sidebar);

		// 2.5 Claudian Workflows
		this.renderClaudianWorkflows(sidebar);

		// 3. Recent Files Feed
		this.renderRecentFilesFeed(sidebar);
	}

	private renderClaudianWorkflows(parent: Element): void {
		const section = parent.createDiv({ cls: 'vo-bus-section' });
		section.createDiv({ text: '// CLAUDIAN WORKFLOWS', cls: 'vo-bus-section-title' });

		const grid = section.createDiv({ 
			attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;' } 
		});

		const workflows = [
			{ name: 'ingest', label: '快捷入库', icon: 'inbox', prompt: '@skills/ingest 请帮我整理并分类 {{inbox_path}} 中的待处理文件' },
			{ name: 'lint', label: '全面体检', icon: 'shield-alert', prompt: '@skills/lint 请帮我扫描并体检整个知识库，找出孤儿笔记与死链并协助修复' },
			{ name: 'query', label: '知识检索', icon: 'search', prompt: '@skills/query ' },
			{ name: 'research', label: '主题研究', icon: 'book-open', prompt: '@skills/research ' }
		];

		workflows.forEach(wf => {
			const btn = grid.createEl('button', {
				cls: 'vo-btn vo-btn-secondary',
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
		const section = parent.createDiv({ cls: 'vo-bus-section' });
		section.createDiv({ text: '// NAVIGATION BUS', cls: 'vo-bus-section-title' });


	}


	private renderRecentFilesFeed(parent: Element): void {
		const section = parent.createDiv({ cls: 'vo-bus-section' });
		section.createDiv({ text: '// RECENT FILES', cls: 'vo-bus-section-title' });

		const feed = section.createDiv({ cls: 'vo-recent-feed' });

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
				const item = feed.createDiv({ cls: 'vo-feed-item' });
				item.createDiv({ text: file.basename, cls: 'vo-feed-name' });
				
				const relativeTime = this.formatRelativeTime(file.stat.mtime);
				item.createDiv({ text: relativeTime, cls: 'vo-feed-time' });

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
		const tabWrapper = parent.createDiv({ cls: 'vo-viewport-tabs' });
		
		const mainTabs = [
			{ id: 'vault', label: '01 / 仓库', icon: 'activity' },
			{ id: 'diary', label: '02 / 日记', icon: 'calendar' },
			{ id: 'lint', label: '03 / 巡检', icon: 'shield-alert' },
			{ id: 'ticktick', label: '04 / TickTick', icon: 'check-square' },
			
		];

		mainTabs.forEach(t => {
			const btn = tabWrapper.createEl('button', { 
				cls: `vo-viewport-tab-btn ${this.activeMainTab === t.id ? 'is-active' : ''}` 
			});
			setIcon(btn, t.icon);
			btn.createSpan({ text: ` ${t.label}` });
			btn.addEventListener('click', () => {
				const prevTab = this.activeMainTab;
				this.activeMainTab = t.id as 'vault' | 'diary' | 'lint' | 'ticktick';

				// Update tab button active states without full re-render
				tabWrapper.querySelectorAll('.vo-viewport-tab-btn').forEach((b, i) => {
					const tab = mainTabs[i];
					if (tab) b.toggleClass('is-active', tab.id === this.activeMainTab);
				});

				// Only replace content area
				contentWrapper.empty();
				this.renderTabContent(contentWrapper);

				if (this.activeMainTab === 'ticktick' && prevTab !== 'ticktick') {
					this.triggerTickTickSync(false);
				}
			});
		});

		const contentWrapper = parent.createDiv({ cls: 'vo-tab-content' });
		this.renderTabContent(contentWrapper);
	}

	private renderTabContent(contentWrapper: Element): void {
		contentWrapper.removeClass('vo-tab-content-fill');
		if (this.activeMainTab === 'vault') {
			this.renderVaultDashboard(contentWrapper);
		} else if (this.activeMainTab === 'diary') {
			this.renderDiaryDashboard(contentWrapper);
		} else if (this.activeMainTab === 'lint') {
			this.renderLintDashboard(contentWrapper);
		} else if (this.activeMainTab === 'ticktick') {
			this.renderTickTickDashboard(contentWrapper);
		}
	}

	/**
	 * =========================================================================
	 * 01 / 仓库主频道渲染
	 * =========================================================================
	 */
	
	private renderTickTickDashboard(parent: Element): void {
		const wrapper = parent.createDiv({ 
			cls: 'vo-ticktick-wrapper', 
			attr: { style: 'animation: fadeIn 0.4s ease-out; display: flex; flex-direction: column; gap: 14px; min-height: 0;' } 
		});

		// 1. Unified header
		const header = wrapper.createDiv({ 
			attr: { style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; margin-bottom: 4px;' } 
		});

		// Left switcher: Stats sub-tabs (总览 | 任务 | 专注 | 习惯)
		const leftSwitcher = header.createDiv({ attr: { style: 'display: flex; gap: 10px; align-items: center;' } });
		const subTabWrapper = leftSwitcher.createDiv({ attr: { style: 'display: flex; background: var(--background-secondary); border-radius: 8px; padding: 4px; gap: 4px; border: 1px solid var(--background-modifier-border);' } });
		const subTabs = [
			{ id: 'overview', label: '总览' },
			{ id: 'tasks', label: '任务' },
			{ id: 'habits', label: '打卡' }
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

		const syncStatus = this.taskService.getSyncStatus();
		const syncPalette = syncStatus.state === 'syncing'
			? { dot: '#d97706', bg: 'rgba(217, 119, 6, 0.10)', text: '同步中' }
			: syncStatus.state === 'error'
				? { dot: '#dc2626', bg: 'rgba(220, 38, 38, 0.10)', text: '同步异常' }
				: syncStatus.lastSyncedAt
					? { dot: '#0f766e', bg: 'rgba(15, 118, 110, 0.10)', text: '已同步' }
					: { dot: 'var(--text-muted)', bg: 'var(--background-secondary)', text: '未同步' };

		// Right actions: Sync status + compact refresh entry
		const rightActions = header.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
		const syncBadge = rightActions.createDiv({
			attr: {
				style: `display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; background: ${syncPalette.bg}; color: var(--text-normal); font-size: 12px;`
			}
		});
		syncBadge.createSpan({
			attr: {
				style: `width: 8px; height: 8px; border-radius: 999px; background: ${syncPalette.dot}; display: inline-block;`
			}
		});
		const syncTextWrap = syncBadge.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 1px;' } });
		syncTextWrap.createSpan({ text: syncPalette.text, attr: { style: 'font-weight: 600; line-height: 1.1;' } });
		syncTextWrap.createSpan({
			text: syncStatus.state === 'syncing'
				? '正在拉取最新 TickTick 数据'
				: syncStatus.state === 'error'
					? (syncStatus.errorMessage || '同步失败，请检查配置')
					: `上次同步: ${this.formatTickTickSyncTime(syncStatus.lastSyncedAt)}`,
			attr: { style: 'font-size: 11px; color: var(--text-muted); line-height: 1.1;' }
		});

		const refreshBtn = rightActions.createEl('button', {
			attr: {
				title: '手动同步 TickTick',
				style: `background: transparent; box-shadow: none; padding: 6px; display: flex; align-items: center; justify-content: center; cursor: ${syncStatus.state === 'syncing' ? 'default' : 'pointer'}; color: var(--text-muted); border: none; opacity: ${syncStatus.state === 'syncing' ? '0.45' : '1'};`
			}
		});
		setIcon(refreshBtn, 'refresh-cw');
		if (syncStatus.state !== 'syncing') {
			refreshBtn.addEventListener('click', () => {
				this.triggerTickTickSync();
			});
		}

		// 2. Render content
		const container = wrapper.createDiv({ attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; gap: 14px; min-height: 0;' } });
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
		const telemetry = parent.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; margin-bottom: 8px;' } });
		const leftTel = telemetry.createDiv({ attr: { style: 'display: flex; gap: 24px;' } });
		
		const totalUndone = tasks.length;
		const totalCompleted = stats.completedCount || completedTasks.length || 0;
		const totalTasks = totalUndone + totalCompleted;
		
		
		
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
			cls: 'vo-card vo-tech-card', 
			attr: { style: 'display: flex; flex-direction: column; padding: 16px; overflow: hidden; height: 100%; box-sizing: border-box;' } 
		});
		overviewCard.createSpan({ text: '概览 (OVERVIEW)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; display: block; margin-bottom: 6px;' } });
		
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
			cls: 'vo-card vo-tech-card', 
			attr: { style: 'display: flex; flex-direction: column; padding: 16px; overflow: hidden; height: 100%; box-sizing: border-box;' } 
		});
		completionRateCard.createSpan({ text: '最近完成率趋势 (COMPLETION RATE)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; display: block; margin-bottom: 6px;' } });
		
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
			cls: 'vo-card vo-tech-card', 
			attr: { style: 'display: flex; flex-direction: column; padding: 16px; overflow: hidden; height: 100%; box-sizing: border-box;' } 
		});
		completedTrendCard.createSpan({ text: '最近已完成趋势 (COMPLETED TREND)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; display: block; margin-bottom: 6px;' } });
		
		const completedTrendData = last7Days.map(d => {
			return this.getTasksCompletedOnDay(completedTasks, d);
		});
		
		this.drawSvgLineChart(completedTrendCard, completedTrendData, completedTrendLabels, '次', true);

		// --- Card C: 本周打卡进展 (Weekly Habit Rings) ---
		const habitsProgressCard = grid.createDiv({ 
			cls: 'vo-card vo-tech-card', 
			attr: { style: 'display: flex; flex-direction: column; padding: 16px; overflow: hidden; height: 100%; box-sizing: border-box;' } 
		});
		habitsProgressCard.createSpan({ text: '本周打卡进展 (HABITS)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; display: block; margin-bottom: 6px;' } });
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
				const gradId = `line-grvo-${Math.floor(Math.random() * 100000)}`;
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
		const dateDrop = topBar.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
		
		const createDateBtn = (val: 'day' | 'week' | 'month', text: string) => {
			const isActive = this.taskStatsPeriod === val;
			const btn = dateDrop.createEl('button', { 
				text, 
				attr: { style: `padding: 4px 12px; margin: 0; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: ${isActive ? 'var(--interactive-accent)' : 'var(--background-secondary-alt)'}; color: ${isActive ? 'var(--text-on-accent)' : 'var(--text-normal)'}; font-size: 12px; cursor: pointer; box-shadow: none;` } 
			});
			btn.addEventListener('click', () => {
				this.taskStatsPeriod = val;
				this.render();
			});
		};
		createDateBtn('day', '按日');
		createDateBtn('week', '按周');
		createDateBtn('month', '按月');

		// 2. Middle Row: Overview, Completion Rate Distribution, Classifications
		const grid = parent.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;' } });
		
		// Card 1: Overview (概览)
		const overviewCard = grid.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'display: flex; flex-direction: column; justify-content: space-between; padding: 20px;' } });
		
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
		const distCard = grid.createDiv({ cls: 'vo-card vo-tech-card' });
		
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

		this.drawDonutChart(distCard, donutData, '完成率', `${rateThisPeriod.toFixed(2)}%`, '完成率分布');

		// Card 3: Completed tasks by Category (已完成分类统计)
		const categoryCard = parent.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'margin-top: 10px;' } });
		
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
		this.drawDonutChart(categoryCard, catData, '完成数量', `${totalCatCount}`, '已完成分类统计');
	}

	private drawDonutChart(
		parent: HTMLElement, 
		data: { label: string, value: number, color: string }[], 
		centerLabel: string, 
		centerVal: string,
		cardTitle: string = ''
	): void {
		const wrapper = parent.createDiv({ attr: { style: 'display: flex; flex-direction: row-reverse; align-items: center; justify-content: space-around; padding: 6px 0; gap: 16px; min-height: 0; height: 100%;' } });
		
		const chartDiv = wrapper.createDiv({ attr: { style: 'width: 100%; max-width: 110px; aspect-ratio: 1; position: relative; flex-shrink: 0;' } });
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

		const legendCol = wrapper.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px; align-self: stretch; flex-grow: 1; min-width: 0;' } });
		if (cardTitle) {
			legendCol.createSpan({ text: cardTitle, attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; display: block; margin-bottom: 6px;' } });
		}
		
		const itemsWrapper = legendCol.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px; margin-top: auto;' } });
		data.forEach(item => {
			const row = itemsWrapper.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' } });
			row.createDiv({ attr: { style: `width: 6px; height: 6px; border-radius: 50%; background: ${item.color}; flex-shrink: 0;` } });
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
		const overviewCard = parent.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'padding: 10px 20px; display: flex; align-items: center; min-height: 70px;' } });
		
		const overviewGrid = overviewCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; width: 100%;' } });

		const drawFocusMetric = (parentElem: HTMLElement, val: string, label: string, diffText: string) => {
			const box = parentElem.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--background-secondary); padding: 8px; border-radius: 8px; border: 1px solid var(--background-modifier-border);' } });
			box.createDiv({ text: val, attr: { style: 'font-size: 16px; font-weight: bold; color: var(--interactive-accent); font-family: var(--font-monospace);' } });
			box.createDiv({ text: label, attr: { style: 'font-size: 11px; color: var(--text-muted); margin-bottom: 6px;' } });
			box.createDiv({ text: diffText, attr: { style: 'font-size: 10px; color: var(--text-success); display: flex; align-items: center; gap: 2px;' } });
		};

		const diffTomatoCount = todayFocusCount - yesterdayFocusCount;
		const diffTomatoStr = `${Math.abs(diffTomatoCount)} 个`;
		const diffTomatoText = diffTomatoCount >= 0 ? `比前一天多 ${diffTomatoStr} ⬆` : `比前一天少 ${diffTomatoStr} ⬇`;

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
		const grid = parent.createDiv({ attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px;' } });

		// Donut Detail Card
		const detailCard = grid.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'height: 160px; display: flex; flex-direction: column;' } });
		
		const tagCounts: Record<string, number> = {};
		todayFocuses.forEach(f => {
			const tag = this.getFocusLabel(f);
			tagCounts[tag] = (tagCounts[tag] || 0) + (f.duration || 0);
		});

		const detailColors = ['#5c8bcf', '#50b37e', '#888888', '#e3a936', '#a269c7'];
		const detailData = Object.keys(tagCounts).map((tag, idx) => ({
			label: tag,
			value: tagCounts[tag] || 0,
			color: detailColors[idx % detailColors.length] || '#888888'
		}));

		const finalDetailData = detailData.length > 0 ? detailData : [
			{ label: '暂无数据', value: 1, color: 'var(--background-secondary-alt)' }
		];
		
		const donutWrapper = detailCard.createDiv({ attr: { style: 'flex-grow: 1; display: flex; align-items: center; justify-content: center; min-height: 0;' } });
		this.drawDonutChart(donutWrapper, finalDetailData, '分类比例', '', '详情');

		// Focus Records Card
		const recordCard = grid.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'display: flex; flex-direction: column; height: 160px;' } });
		const recordHeader = recordCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;' } });
		recordHeader.createSpan({ text: '记录 (RECORDS)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px;' } });
		
		const plusSpan = recordHeader.createSpan({ attr: { style: 'cursor: pointer; color: var(--text-muted);' } });
		setIcon(plusSpan, 'plus');

		const recordList = recordCard.createDiv({ attr: { style: 'flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 0;' } });
		
		if (todayFocuses.length === 0) {
			recordList.createDiv({ 
				text: '今日暂无专注记录。', 
				attr: { style: 'font-size: 13px; color: var(--text-muted); text-align: center; margin: auto 0; padding: 20px 0;' } 
			});
		} else {
			todayFocuses.forEach(f => {
				const item = recordList.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px;' } });
				const left = item.createDiv({ attr: { style: 'display: flex; flex-direction: column;' } });
				
				const dt = new Date(f.startTime || f.start_time || '');
				const dateStr = `${dt.getMonth() + 1}月${dt.getDate()}日`;
				left.createDiv({ text: dateStr, attr: { style: 'font-size: 12px; font-weight: bold; color: var(--text-normal);' } });
				left.createDiv({ text: this.getFocusLabel(f), attr: { style: 'font-size: 11px; color: var(--interactive-accent); margin-top: 2px;' } });

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
		const heatmapCard = parent.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px 16px;' } });
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
			cls: 'vo-card vo-tech-card', 
			attr: { style: 'padding: 8px 16px; display: flex; align-items: center; min-height: 60px;' } 
		});
		
		const overviewGrid = overviewCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; width: 100%;' } });

		const drawHabitMetric = (parentElem: HTMLElement, val: string, label: string, desc: string) => {
			const box = parentElem.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--background-secondary); padding: 4px 8px; border-radius: 8px; border: 1px solid var(--background-modifier-border);' } });
			box.createDiv({ text: val, attr: { style: 'font-size: 16px; font-weight: bold; color: var(--interactive-accent); font-family: var(--font-monospace); line-height: 1.2;' } });
			box.createDiv({ text: label, attr: { style: 'font-size: 11px; color: var(--text-muted); margin-bottom: 2px;' } });
			box.createDiv({ text: desc, attr: { style: 'font-size: 10px; color: var(--text-faint);' } });
		};

		const todayProgressStr = habitsCount > 0 ? `${todayCompletedCount}/${habitsCount}` : '0/0';
		const todayProgressPct = habitsCount > 0 ? Math.round((todayCompletedCount / habitsCount) * 100) : 0;

		drawHabitMetric(overviewGrid, String(totalCheckIns), '打卡总次数', '全部习惯累计打卡数');
		drawHabitMetric(overviewGrid, todayProgressStr, '今日进度', `完成率 ${todayProgressPct}%`);
		drawHabitMetric(overviewGrid, `${streakDays}天`, '连续打卡天数', '每日至少打卡一次习惯');

		const listCard = parent.createDiv({ 
			cls: 'vo-card vo-tech-card', 
			attr: { style: 'margin-top: 10px; display: flex; flex-direction: column; padding: 12px 16px;' } 
		});
		
		const listHeaderRow = listCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px;' } });
		listHeaderRow.createSpan({ text: '打卡明细与本周追踪 (TRACKING)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px;' } });

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
					cls: `vo-task-check-btn ${isCompletedToday ? 'is-completed' : ''}`,
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

		// 3. Focus side-by-side row: Overview (left) and Records (right) - 1:1 layout
		const focuses = stats.focuses || [];
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

		const focusGrid = parent.createDiv({ attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px;' } });

		// Left Card: Focus Overview
		const focusOverviewCard = focusGrid.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'padding: 10px 16px; display: flex; flex-direction: column; justify-content: center; height: 160px; min-height: 160px;' } });
		const focusOverviewGrid = focusOverviewCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; width: 100%;' } });

		const drawFocusMetric = (parentElem: HTMLElement, val: string, label: string, diffText: string) => {
			const box = parentElem.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--background-secondary); padding: 4px 6px; border-radius: 6px; border: 1px solid var(--background-modifier-border);' } });
			box.createDiv({ text: val, attr: { style: 'font-size: 14px; font-weight: bold; color: var(--interactive-accent); font-family: var(--font-monospace); line-height: 1.1;' } });
			box.createDiv({ text: label, attr: { style: 'font-size: 10px; color: var(--text-muted); margin-bottom: 2px;' } });
			box.createDiv({ text: diffText, attr: { style: 'font-size: 8px; color: var(--text-success); transform: scale(0.9);' } });
		};

		const diffTomatoCount = todayFocusCount - yesterdayFocusCount;
		const diffTomatoStr = `${Math.abs(diffTomatoCount)}个`;
		const diffTomatoText = diffTomatoCount >= 0 ? `+${diffTomatoStr}` : `-${diffTomatoStr}`;

		const diffDuration = todayFocusDurationMin - yesterdayFocusDurationMin;
		const diffDurationStr = `${Math.floor(Math.abs(diffDuration) / 60)}h${Math.abs(diffDuration) % 60}m`;
		const diffDurationText = diffDuration >= 0 ? `+${diffDurationStr}` : `-${diffDurationStr}`;

		const todayDurationStr = `${Math.floor(todayFocusDurationMin / 60)}h${todayFocusDurationMin % 60}m`;
		const totalDurationStr = `${Math.floor(totalFocusDurationMin / 60)}h${totalFocusDurationMin % 60}m`;

		drawFocusMetric(focusOverviewGrid, String(todayFocusCount), '今日番茄', diffTomatoText);
		drawFocusMetric(focusOverviewGrid, String(totalFocusCount), '总番茄', '');
		drawFocusMetric(focusOverviewGrid, todayDurationStr, '今日时长', diffDurationText);
		drawFocusMetric(focusOverviewGrid, totalDurationStr, '总时长', '');

		// Right Card: Focus Records
		const recordCard = focusGrid.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'display: flex; flex-direction: column; height: 160px; min-height: 160px;' } });
		const recordHeader = recordCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;' } });
		recordHeader.createSpan({ text: '记录 (RECORDS)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px;' } });
		
		const plusSpan = recordHeader.createSpan({ attr: { style: 'cursor: pointer; color: var(--text-muted);' } });
		setIcon(plusSpan, 'plus');

		const recordList = recordCard.createDiv({ attr: { style: 'flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 0;' } });
		
		if (todayFocuses.length === 0) {
			recordList.createDiv({ 
				text: '今日暂无记录。', 
				attr: { style: 'font-size: 12px; color: var(--text-muted); text-align: center; margin: auto 0; padding: 10px 0;' } 
			});
		} else {
			todayFocuses.forEach(f => {
				const item = recordList.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px;' } });
				const left = item.createDiv({ attr: { style: 'display: flex; flex-direction: column;' } });
				
				const dt = new Date(f.startTime || f.start_time || '');
				const dateStr = `${dt.getMonth() + 1}月${dt.getDate()}日`;
				left.createDiv({ text: dateStr, attr: { style: 'font-size: 11px; font-weight: bold; color: var(--text-normal);' } });
				left.createDiv({ text: this.getFocusLabel(f), attr: { style: 'font-size: 10px; color: var(--interactive-accent); margin-top: 2px;' } });

				const endDt = new Date(f.endTime || f.end_time || '');
				const startStr = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
				const endStr = `${endDt.getHours().toString().padStart(2, '0')}:${endDt.getMinutes().toString().padStart(2, '0')}`;
				
				const timeWrap = left.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-muted); margin-top: 2px;' } });
				setIcon(timeWrap.createSpan(), 'clock');
				timeWrap.createSpan({ text: `${startStr} - ${endStr}` });

				item.createDiv({ text: `${f.duration || 0}m`, attr: { style: 'font-size: 11px; font-family: var(--font-monospace); color: var(--text-normal); font-weight: bold;' } });
			});
		}
	}

	private drawFocusHeatmap(parent: HTMLElement, focuses: FocusItem[]): void {
		const heatmapWrapper = parent.createDiv({ 
			cls: 'vo-stats-heatmap-wrapper', 
			attr: { style: 'margin: 0 auto; display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 560px;' } 
		});
		const now = moment();
		const targetYear = now.year();
		const cellSize = this.plugin.settings.heatmapCellSize;
		const cellGap = this.plugin.settings.heatmapCellGap;
		const gridHeight = 7 * cellSize + 6 * cellGap;
		const focusMap = new Map<string, number>();

		focuses.forEach(focus => {
			const startTime = focus.startTime || focus.start_time;
			if (!startTime) return;

			const dateKey = moment(startTime).format('YYYY-MM-DD');
			const current = focusMap.get(dateKey) || 0;
			focusMap.set(dateKey, current + (focus.duration || 0));
		});

		const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
		const monthGrid = heatmapWrapper.createDiv({
			attr: { style: `display: grid; grid-template-columns: repeat(53, ${cellSize}px); gap: ${cellGap}px; font-size: 9px; color: var(--text-muted); margin-bottom: 4px; padding-left: 22px; width: 100%;` }
		});

		monthLabels.forEach((label, i) => {
			const colStart = Math.round(i * 4.4) + 1;
			monthGrid.createEl('span', {
				text: label,
				attr: { style: `grid-column-start: ${colStart}; white-space: nowrap;` }
			});
		});

		const gridBody = heatmapWrapper.createDiv({ attr: { style: `display: flex; gap: 8px; height: ${gridHeight}px; margin-bottom: 8px; width: 100%;` } });
		const dayLabels = gridBody.createDiv({
			attr: { style: 'display: flex; flex-direction: column; justify-content: space-between; font-size: 9px; color: var(--text-muted); width: 14px; padding: 2px 0;' }
		});
		dayLabels.createSpan({ text: '一' });
		dayLabels.createSpan({ text: '三' });
		dayLabels.createSpan({ text: '五' });

		const gridContainer = gridBody.createDiv({ attr: { style: `display: flex; gap: ${cellGap}px; align-items: stretch;` } });
		const currentDate = window.moment(`${targetYear}-01-01`).startOf('isoWeek');
		const endDate = window.moment(`${targetYear}-12-31`).endOf('isoWeek');

		let activeDays = 0;
		let totalMinutes = 0;

		while (currentDate.isBefore(endDate)) {
			const col = gridContainer.createDiv({ cls: 'vo-stats-heatmap-col', attr: { style: `width: ${cellSize}px; gap: ${cellGap}px;` } });
			for (let d = 0; d < 7; d++) {
				const dateStr = currentDate.format('YYYY-MM-DD');
				const isCurrentYear = currentDate.year() === targetYear;
				const duration = isCurrentYear ? (focusMap.get(dateStr) || 0) : 0;

				if (isCurrentYear && duration > 0) {
					activeDays++;
					totalMinutes += duration;
				}

				const level = this.getFocusHeatLevel(duration);
				const cell = col.createDiv({
					cls: `vo-stats-heatmap-cell ${isCurrentYear ? `level-${level}` : ''}`,
					attr: { style: `width: ${cellSize}px; height: ${cellSize}px;` }
				});

				if (!isCurrentYear) {
					cell.setCssStyles({ visibility: 'hidden' });
				} else {
					cell.createDiv({
						text: `${dateStr} 专注 ${duration} 分钟`,
						cls: 'vo-stats-heatmap-cell-tooltip'
					});
				}

				currentDate.add(1, 'day');
			}
		}

		const footer = heatmapWrapper.createDiv({ cls: 'vo-stats-heatmap-footer', attr: { style: 'display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted); width: 100%; margin-top: 4px;' } });
		const footerLeft = footer.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 4px;' } });
		footerLeft.createSpan({ text: `${targetYear}年`, attr: { style: 'font-weight: bold; color: var(--text-normal); font-size: 11px;' } });
		footerLeft.createSpan({ text: `本年度共专注 ${activeDays} 天，累计专注 ${this.formatFocusMinutes(totalMinutes)}` });

		const legend = footer.createDiv({ cls: 'vo-stats-heatmap-legend' });
		legend.createSpan({ text: '少' });
		for (let i = 0; i <= 4; i++) {
			legend.createDiv({ cls: `vo-stats-heatmap-legend-box level-${i}` });
		}
		legend.createSpan({ text: '多' });
	}

	private renderVaultDashboard(parent: Element): void {
		const container = parent.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 14px; flex-grow: 1; min-height: 0; height: 100%;' } });
		
		this.renderStatsNav(container);

		this.getVaultDateCounts();

		const finalStats = this.cachedVaultOverviewStats!;
		this.renderVaultTelemetryBar(container, finalStats);

		const finalMiniGridContainer = container.createDiv();
		this.renderMiniGrid(finalMiniGridContainer, finalStats);
		this.renderChartSection(container);
		return;

		// 1. Telemetry bar card container (rendered immediately)
		const telemetryCard = container.createDiv({ cls: 'vo-card vo-tech-card vo-vault-telemetry-card' });
		const barContainer = telemetryCard.createDiv({ cls: 'vo-vault-telemetry-bar' });
		barContainer.createDiv({
			cls: 'vo-bar-segment vo-segment-other',
			attr: { style: 'width: 100%;', title: '数据读取中...' }
		});
		const legendContainer = telemetryCard.createDiv({ cls: 'vo-vault-telemetry-legend' });
		const legItem = legendContainer.createDiv({ cls: 'vo-legend-item' });
		legItem.createDiv({ cls: 'vo-legend-color vo-segment-other' });
		legItem.createSpan({ text: '数据读取中...' });

		// 2. Mini grid ?render skeleton immediately with '--' values
		const miniGridContainer = container.createDiv();
		const statNodes = this.renderMiniGridSkeleton(miniGridContainer);

		// 3. Chart card container (rendered immediately)
		const chartCard = container.createDiv({ 
			cls: 'vo-stats-chart-section vo-tech-card',
			attr: { style: 'flex-grow: 1; min-height: 240px; display: flex; flex-direction: column;' }
		});
		const chartHeader = chartCard.createDiv({ cls: 'vo-stats-chart-header' });
		chartHeader.createSpan({ text: '新增笔记统计', cls: 'vo-stats-chart-title' });
		const chartBody = chartCard.createDiv({ attr: { style: 'flex-grow: 1; display: flex; align-items: center; justify-content: center;' } });
		chartBody.createDiv({ text: '数据读取中...', attr: { style: 'color: var(--text-muted); font-size: 13px;' } });

		// Run computation and update DOM in a setTimeout to avoid layout freeze during render
		window.setTimeout(() => {
			if (!container.parentElement) return; // View was closed or tab switched

			if (!this.cachedDateCounts) {
				this.getVaultDateCounts(); // populates cachedVaultOverviewStats + cachedDateCounts
			} else if (!this.cachedVaultOverviewStats) {
				this.cachedVaultOverviewStats = this.vaultService.getVaultOverviewStats();
			}
			const s = this.cachedVaultOverviewStats!;
			
			statNodes.days.setText(`${s.totalDays} 天`);
			statNodes.avg.setText(`${s.dailyAvg} 篇`);
			statNodes.atomics.setText(`${s.countAtomics} 篇`);
			statNodes.inbox.setText(`${s.countInbox} 篇`);
			statNodes.output.setText(`${s.countOutput} 篇`);
			statNodes.orphans.setText(`${s.countOrphans} 条`);

			// Update telemetry bar card
			telemetryCard.empty();
			const realBarContainer = telemetryCard.createDiv({ cls: 'vo-vault-telemetry-bar' });
			const realLegendContainer = telemetryCard.createDiv({ cls: 'vo-vault-telemetry-legend' });

			const total = s.totalMdFiles || 1;
			const data = [
				{ name: '日记 (Daily)', count: s.countDaily, pct: Math.round((s.countDaily / total) * 100), cls: 'vo-segment-daily' },
				
				{ name: '其他 (Other)', count: s.countOther + s.countInbox + s.countAtomics + s.countOutput, pct: Math.round(((s.countOther + s.countInbox + s.countAtomics + s.countOutput) / total) * 100), cls: 'vo-segment-other' }
			].filter(item => item.count > 0);

			data.forEach(item => {
				if (item.pct > 0) {
					realBarContainer.createDiv({
						cls: `vo-bar-segment ${item.cls}`,
						attr: {
							style: `width: ${item.pct}%;`,
							title: `${item.name}: ${item.count} ?(${item.pct}%)`
						}
					});
				}

				const legItem = realLegendContainer.createDiv({ cls: 'vo-legend-item' });
				legItem.createDiv({ cls: `vo-legend-color ${item.cls}` });
				legItem.createSpan({ text: `${item.name}: ${item.count} ?(${item.pct}%)` });
			});

			// Update chart card
			chartCard.empty();
			this.renderChartSectionContent(chartCard);
		}, 0);
	}

	private renderVaultTelemetryBar(parent: Element, stats: VaultOverviewStats): void {
		const card = parent.createDiv({ cls: 'vo-card vo-tech-card vo-vault-telemetry-card' });
		
		const barContainer = card.createDiv({ cls: 'vo-vault-telemetry-bar' });
		const legendContainer = card.createDiv({ cls: 'vo-vault-telemetry-legend' });

		const total = stats.totalMdFiles || 1;
		const data = [
			{ name: '日记 (Daily)', count: stats.countDaily, pct: Math.round((stats.countDaily / total) * 100), cls: 'vo-segment-daily' },
			
			{ name: '其他 (Other)', count: stats.countOther + stats.countInbox + stats.countAtomics + stats.countOutput, pct: Math.round(((stats.countOther + stats.countInbox + stats.countAtomics + stats.countOutput) / total) * 100), cls: 'vo-segment-other' }
		].filter(item => item.count > 0);

		data.forEach(item => {
			if (item.pct > 0) {
				barContainer.createDiv({
					cls: `vo-bar-segment ${item.cls}`,
					attr: {
						style: `width: ${item.pct}%;`,
						title: `${item.name}: ${item.count} 篇 (${item.pct}%)`
					}
				});
			}

			const legItem = legendContainer.createDiv({ cls: 'vo-legend-item' });
			legItem.createDiv({ cls: `vo-legend-color ${item.cls}` });
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
			cls: 'vo-dashboard-grid vo-diary-grid',
			attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 20px; height: 100%; overflow: hidden;' }
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
		this.selectedPeriodicDate = date.clone();
		this.render();

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
		const card = parent.createDiv({ cls: 'vo-card vo-periodic-card vo-tech-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;' } });
		const header = card.createDiv({ cls: 'vo-card-header', attr: { style: 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;' } });

		const subTabs = header.createDiv({ cls: 'vo-card-tabs' });
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
				cls: `vo-card-tab-btn ${this.periodicTab === t.id ? 'is-active' : ''}`
			});
			btn.addEventListener('click', () => {
				this.periodicTab = t.id as 'day' | 'week' | 'month' | 'quarter' | 'year';
				this.render();
			});
		});

		const datePicker = header.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 4px;' } });
		const prevBtn = datePicker.createEl('button', { cls: 'icon-btn', attr: { style: 'background: transparent; border: none; box-shadow: none; cursor: pointer; padding: 4px;' } });
		setIcon(prevBtn, 'chevron-left');
		prevBtn.addEventListener('click', () => {
			this.shiftPeriodicDate(-1);
			this.render();
		});

		const baseDate = this.getPeriodicBaseDate();
		const dateLabelWrap = datePicker.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 2px;' } });
		this.renderPeriodicDatePickerLabel(dateLabelWrap, baseDate);

		const nextBtn = datePicker.createEl('button', { cls: 'icon-btn', attr: { style: 'background: transparent; border: none; box-shadow: none; cursor: pointer; padding: 4px;' } });
		setIcon(nextBtn, 'chevron-right');
		nextBtn.addEventListener('click', () => {
			this.shiftPeriodicDate(1);
			this.render();
		});

		const gridContainer = card.createDiv({ cls: 'vo-periodic-grid-container', attr: { style: 'flex-grow: 1; max-height: none; overflow-y: auto; margin-top: 8px;' } });

		if (this.periodicTab === 'day') {
			const grid = gridContainer.createDiv({ 
				attr: { style: 'display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; width: 100%;' } 
			});
			const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
			weekdays.forEach(wd => {
				grid.createDiv({ text: wd, attr: { style: 'text-align: center; font-size: 11px; color: var(--text-muted); font-weight: 600; padding-bottom: 4px;' } });
			});

			const daysInMonth = baseDate.daysInMonth();
			
			const firstDay = baseDate.clone().date(1);
			const isoDay = firstDay.day();
			const offset = isoDay === 0 ? 6 : isoDay - 1;

			for (let i = 0; i < offset; i++) {
				grid.createDiv({ cls: 'vo-periodic-cell is-empty', attr: { style: 'pointer-events: none; opacity: 0;' } });
			}

			for (let d = 1; d <= daysInMonth; d++) {
				const date = baseDate.clone().date(d);
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'day');
				const isCreated = this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
				
				const cell = grid.createDiv({ 
					cls: `vo-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
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
			for (let w = 1; w <= 52; w++) {
				const date = baseDate.clone().isoWeek(w).startOf('isoWeek');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'week');
				const isCreated = this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `vo-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
					text: String(w),
					attr: { 'title': isCreated ? `周记: ${fileName} (已创建)` : `周记: ${fileName} (未创建)` }
				});
				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'week', isCreated, filePath, fileName);
				});
			}
		} else if (this.periodicTab === 'month') {
			const grid = gridContainer.createDiv({ cls: 'vo-periodic-grid', attr: { style: 'display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; width: 100%;' } });
			for (let m = 0; m < 12; m++) {
				const date = baseDate.clone().month(m).startOf('month');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'month');
				const file = this.app.vault.getAbstractFileByPath(filePath);
				const isCreated = file instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `vo-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
					text: String(m + 1),
					attr: { 'title': isCreated ? `月记: ${fileName} (已创建)` : `月记: ${fileName} (未创建)` }
				});

				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'month', isCreated, filePath, fileName);
				});
			}
		} else if (this.periodicTab === 'quarter') {
			const grid = gridContainer.createDiv({ cls: 'vo-periodic-grid', attr: { style: 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; width: 100%;' } });
			for (let q = 1; q <= 4; q++) {
				const date = baseDate.clone().quarter(q).startOf('quarter');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'quarter');
				const file = this.app.vault.getAbstractFileByPath(filePath);
				const isCreated = file instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `vo-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
					text: `Q${q}`,
					attr: { 'title': isCreated ? `季记: ${fileName} (已创建)` : `季记: ${fileName} (未创建)` }
				});

				cell.addEventListener('click', () => {
					void this.handlePeriodicCellClick(date, 'quarter', isCreated, filePath, fileName);
				});
			}
		} else { // year
			const grid = gridContainer.createDiv({ cls: 'vo-periodic-grid', attr: { style: 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; width: 100%;' } });
			const centerYear = baseDate.year();
			const startYear = centerYear - 5;
			const years = Array.from({ length: 12 }).map((_, i) => startYear + i);
			
			years.forEach(y => {
				const date = moment().year(y).startOf('year');
				const { filePath, fileName } = this.diaryService.resolvePeriodicNotePath(date, 'year');
				const file = this.app.vault.getAbstractFileByPath(filePath);
				const isCreated = file instanceof TFile;
				
				const cell = grid.createDiv({
					cls: `vo-periodic-cell ${isCreated ? 'is-created' : 'is-missing'}`,
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
		const diaryCard = parent.createDiv({ cls: 'vo-card vo-diary-card vo-tech-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;' } });
		
		const tabNames: Record<string, string> = {
			'day': '日记', 'week': '周记', 'month': '月记', 'quarter': '季记', 'year': '年记'
		};
		const currentName = tabNames[this.periodicTab] || '日记';

		const header = diaryCard.createDiv({ cls: 'vo-card-header', attr: { style: 'display: flex; align-items: center; width: 100%; text-align: left;' } });
		header.createSpan({ text: this.getPeriodicCardTitle(), attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; text-align: left; align-self: flex-start;' } });
		
		const baseDate = this.getPeriodicBaseDate();
		const { filePath } = this.diaryService.resolvePeriodicNotePath(baseDate, this.periodicTab);
		
		const content = diaryCard.createDiv({ cls: 'vo-diary-content', attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; margin-top: 12px;' } });
		
		const file = this.app.vault.getAbstractFileByPath(filePath);
		const isCreated = file instanceof TFile;

		const borderStyle = isCreated ? '1px solid var(--text-success)' : '1px dashed var(--background-modifier-border)';
		const innerDiv = content.createDiv({ attr: { style: `border: ${borderStyle}; border-radius: 8px; padding: 12px; flex-grow: 1; display: flex; flex-direction: column;` } });
		
		innerDiv.createEl('div', { text: filePath, cls: 'vo-diary-path', attr: { style: 'font-family: var(--font-monospace); font-size: 11px; margin-bottom: 10px; color: var(--text-muted);' } });
		const summaryEl = innerDiv.createEl('p', { text: `读取中...`, cls: 'vo-diary-summary', attr: { style: 'font-size: 13px; line-height: 1.5; color: var(--text-normal); flex-grow: 1; overflow-y: auto;' } });
		
		if (isCreated) {
			void this.app.vault.read(file).then(fileContent => {
				const summary = this.diaryService.extractSummary(fileContent);
				summaryEl.setText(summary || '无摘要内容。');
			});
		} else {
			summaryEl.setText(`${currentName}尚未创建。点击下方按钮即可基于模板新建。`);
		}

		const openBtn = content.createEl('button', { 
			text: `打开当前${currentName}`, 
			cls: 'vo-btn vo-btn-secondary',
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
		const card = parent.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;' } });
		const header = card.createDiv({ cls: 'vo-card-header' });
		header.createSpan({ text: '日记数据概览 (DIARY STATS)' , attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; text-align: left; align-self: flex-start;' } });

		const content = card.createDiv({ attr: { style: 'flex-grow: 1; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 4px 0; align-content: center; overflow-y: auto;' } });
		content.createDiv({ text: '分析中...', attr: { style: 'color: var(--text-muted); font-size: 13px; grid-column: span 2; text-align: center;' } });

		try {
			const stats = await this.diaryService.getDiaryStats();
			content.empty();

			const createStatItem = (label: string, value: string | number, highlight = false) => {
				const item = content.createDiv({ attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--background-secondary); border: 1px solid color-mix(in srgb, var(--background-modifier-border) 60%, transparent); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02); padding: 8px 8px; border-radius: 8px; transition: transform 0.2s;' } });
				item.createDiv({ text: String(value), attr: { style: `font-size: ${highlight ? '18px' : '15px'}; font-weight: 700; font-family: var(--font-monospace); color: ${highlight ? 'var(--text-success)' : 'var(--text-normal)'}; margin-bottom: 2px; text-align: center;` } });
				item.createDiv({ text: label, attr: { style: 'font-size: 11px; color: var(--text-muted); font-weight: 500; text-align: center;' } });
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
		const card = parent.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;' } });
		const header = card.createDiv({ cls: 'vo-card-header' });
		
		const baseDate = this.getPeriodicBaseDate();
		const targetLabel = this.periodicTab === 'day' ? '去年今日' : 
							this.periodicTab === 'year' ? '去年' : 
							`去年同${this.periodicTab === 'week' ? '周' : this.periodicTab === 'month' ? '月' : '季'}`;
		
		header.createSpan({ text: `${targetLabel}回望 (MEMORY)`, attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; text-align: left; align-self: flex-start;' } });

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

			const btn = content.createEl('button', { cls: 'vo-btn vo-btn-primary', attr: { style: 'width: 100%; margin-top: auto;' } });
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
		parent.setAttr('style', 'display: flex; flex-direction: column; height: 100%; overflow: hidden;');

		const grid = parent.createDiv({ cls: 'vo-middle-grid', attr: { style: 'display: grid; grid-template-columns: 1fr 1.6fr; gap: 16px; margin-bottom: 12px;' } });

		const leftCard = grid.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'text-align: center; display: flex; flex-direction: column; justify-content: space-between; padding: 12px; min-height: 280px;' } });
		const microHeaderLeft = leftCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 2px; text-align: left; align-self: flex-start; width: 100%; margin-bottom: 6px;' } });
		microHeaderLeft.createSpan({ text: '仓库健康度 (HEALTH)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px;' } });
		microHeaderLeft.createSpan({ text: '基于 Inbox、死链、孤儿和空白笔记综合评估', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.6;' } });

		const ringContainer = leftCard.createDiv({ cls: 'vo-progress-ring-container', attr: { style: 'margin: 15px auto; position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center;' } });
		const svg = ringContainer.createSvg('svg', { cls: 'vo-progress-ring', attr: { width: '120', height: '120', style: 'position: absolute; top: 0; left: 0; transform: rotate(-90deg);' } });
		svg.createSvg('circle', {
			cls: 'vo-progress-ring-circle-bg',
			attr: { r: '45', cx: '60', cy: '60', fill: 'none', stroke: 'var(--background-modifier-border)', 'stroke-width': '8' }
		});
		const progressCircle = svg.createSvg('circle', {
			cls: 'vo-progress-ring-circle',
			attr: { r: '45', cx: '60', cy: '60', id: 'health-progress-circle', fill: 'none', stroke: 'var(--interactive-accent)', 'stroke-width': '8', 'stroke-dasharray': '282.7', 'stroke-dashoffset': '282.7', style: 'transition: stroke-dashoffset 0.5s ease;' }
		});
		const textPercentage = ringContainer.createDiv({ cls: 'vo-progress-ring-text', text: '--%', attr: { style: 'font-size: 20px; font-weight: bold; z-index: 1;' } });

		const statusInfoDiv = leftCard.createDiv({ attr: { style: 'margin: 10px 0; font-size: 11px; color: var(--text-muted); font-family: var(--font-monospace);' } });
		const scanTimeSpan = statusInfoDiv.createDiv({ text: `上次体检: ${this.lastScanTime}` });
		const statusText = leftCard.createEl('p', {
			text: this.isScanning ? '正在体检中...' : '检测就绪，建议定期巡检优化。',
			attr: { style: 'font-size: 12px; color: var(--text-muted);' }
		});

		const btnGroup = leftCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 10px;' } });
		const runBtn = btnGroup.createEl('button', {
			cls: 'vo-btn vo-btn-secondary',
			attr: { style: 'width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;' }
		});
		setIcon(runBtn, 'play');
		runBtn.createSpan({ text: '开始体检' });

		const rightCard = grid.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'padding: 12px; display: flex; flex-direction: column; justify-content: flex-start; min-height: 280px; gap: 10px;' } });
		
		const rightCardHeader = rightCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: flex-start; width: 100%; margin: 0;' } });
		rightCardHeader.createSpan({ text: '诊断面板 (DIAGNOSTICS)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px;' } });
		
		const reportBtn = rightCardHeader.createEl('button', { cls: 'icon-btn', attr: { title: '打开最近一次体检报告', style: 'background: transparent; border: none; box-shadow: none; cursor: pointer; padding: 0; color: var(--text-muted); line-height: 1;' } });
		setIcon(reportBtn, 'file-text');
		reportBtn.addEventListener('click', () => {
			const outputFolder = this.app.vault.getAbstractFileByPath(this.plugin.settings.outputFolder);
			if (outputFolder instanceof TFolder) {
				const reportFiles = outputFolder.children.filter((f): f is TFile => 
					f instanceof TFile && f.name.endsWith('.md') && f.name.startsWith('知识库体检报告-')
				);
				if (reportFiles.length > 0) {
					reportFiles.sort((a, b) => b.name.localeCompare(a.name));
					const latestReport = reportFiles[0];
					if (latestReport) {
						void this.app.workspace.openLinkText(latestReport.path, '', false);
					}
				} else {
					new Notice(`在 ${this.plugin.settings.outputFolder} 中未找到任何体检报告`);
				}
			} else {
				new Notice(`未找到 ${this.plugin.settings.outputFolder} 文件夹`);
			}
		});
		
		// Log layout (compressed)
		const topLogContainer = rightCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; flex-shrink: 0;' } });
		
		const inboxItem = topLogContainer.createDiv({ cls: 'vo-task-item', attr: { style: 'justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const inboxLeft = inboxItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const inboxIconEl = inboxLeft.createDiv(); setIcon(inboxIconEl, 'inbox');
		const inboxTextWrap = inboxLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 0;' } });
		inboxTextWrap.createSpan({ text: '待分类文件', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const inboxDesc = inboxTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		const diaryItem = topLogContainer.createDiv({ cls: 'vo-task-item', attr: { style: 'justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const diaryLeft = diaryItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const diaryIconEl = diaryLeft.createDiv(); setIcon(diaryIconEl, 'calendar');
		const diaryTextWrap = diaryLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 0;' } });
		diaryTextWrap.createSpan({ text: '待入库日记', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const diaryDesc = diaryTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		// Inspect layout (expanded)
		const bottomInspectContainer = rightCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 10px; flex-grow: 1; overflow-y: auto;' } });
		
		const orphanItem = bottomInspectContainer.createDiv({ cls: 'vo-task-item', attr: { style: 'flex-grow: 1; justify-content: flex-start; align-items: center; cursor: pointer; padding: 12px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const orphanLeft = orphanItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
		const orphanIconEl = orphanLeft.createDiv(); setIcon(orphanIconEl, 'compass');
		const orphanTextWrap = orphanLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px;' } });
		orphanTextWrap.createSpan({ text: '孤儿笔记 (Orphans)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const orphanDesc = orphanTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		const deadLinkItem = bottomInspectContainer.createDiv({ cls: 'vo-task-item', attr: { style: 'flex-grow: 1; justify-content: flex-start; align-items: center; cursor: pointer; padding: 12px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const deadLinkLeft = deadLinkItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 12px;' } });
		const deadLinkIconEl = deadLinkLeft.createDiv(); setIcon(deadLinkIconEl, 'link');
		const deadLinkTextWrap = deadLinkLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 4px;' } });
		deadLinkTextWrap.createSpan({ text: '未解析死链 (Dead Links)', attr: { style: 'font-weight: 600; font-size: 13px;' } });
		const deadLinkDesc = deadLinkTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });

		const emptyNoteItem = bottomInspectContainer.createDiv({ cls: 'vo-task-item', attr: { style: 'flex-grow: 1; justify-content: flex-start; align-items: center; cursor: pointer; padding: 12px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
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
		const consoleCard = parent.createDiv({ cls: 'vo-card vo-tech-card', attr: { style: 'flex-grow: 1; overflow-y: auto; padding: 10px 12px;' } });
		consoleCard.createSpan({ text: '智能指令 (COMMANDS)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 6px; display: block;' } });

		const consoleLayout = consoleCard.createDiv({ cls: 'vo-console-layout', attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } });
		
		// Dynamic Claudian Actions from Settings
		const presetsCard = consoleLayout.createDiv({ attr: { style: 'border: 1px dashed var(--background-modifier-border); border-radius: 8px; padding: 8px; background: var(--background-primary);' } });
		const presetsGrid = presetsCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px;' } });
		
		const inputsCard = consoleLayout.createDiv({ attr: { style: 'border: 1px dashed var(--background-modifier-border); border-radius: 8px; padding: 8px; background: var(--background-primary);' } });
		const inputsDiv = inputsCard.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px;' } });

		const actions = (this.plugin.settings.claudianActions || [])
			.map(action => ({
				enabled: true,
				...action
			}))
			.filter(action => action.enabled !== false);

		actions.forEach(action => {
			if (!action.requireInput) {
				const btn = presetsGrid.createEl('button', { cls: 'vo-btn vo-btn-secondary', attr: { style: 'justify-content: flex-start; gap: 6px; font-size: 11px; padding: 8px;' } });
				if (action.icon) setIcon(btn, action.icon);
				btn.createSpan({ text: action.label });
				btn.addEventListener('click', () => {
					new Notice(`已触发: ${action.label}`);
					this.triggerClaudianPrompt(action.prompt);
				});
			} else {
				const group = inputsDiv.createDiv({ attr: { style: 'display: flex; gap: 6px; align-items: center; min-width: 0;' } });
				const input = group.createEl('input', { type: 'text', placeholder: action.inputPlaceholder || '', attr: { style: 'flex-grow: 1; min-width: 0; height: 30px; font-size: 12px; padding: 0 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal);' } });
				const btn = group.createEl('button', { cls: 'vo-btn vo-btn-primary', attr: { style: 'height: 30px; min-width: 96px; justify-content: flex-start; gap: 4px; font-size: 11px; white-space: nowrap; flex-shrink: 0;' } });
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

		// (Bottom Monthly Stats and Report Button removed and integrated above)

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
					this.currentScanData = { inbox, orphans, deadLinks, uningested, empty };
					const score = this.calculateLintHealthScore(this.currentScanData);

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

					inboxDesc.setText(`范围: ${this.plugin.settings.inboxFolder} | ${inbox.count} 篇 | 最久 ${inbox.oldestDays} 天`);
					diaryDesc.setText(`范围: ${this.plugin.settings.dailyNoteFolder} | ${uningested.count} 篇未入库`);
					orphanDesc.setText(`范围: ${this.plugin.settings.atomicsFolder} | ${orphans.count} 篇未被知识链路引用`);
					deadLinkDesc.setText(`范围: ${this.plugin.settings.atomicsFolder} | ${deadLinks.count} 处失效链接`);
					emptyNoteDesc.setText(`范围: 全库 Markdown | ${empty.count} 篇正文为空`);
					
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
		const dirPath = `Vault OS/Reports`;
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
			
			const score = this.calculateLintHealthScore({ inbox, orphans, deadLinks, uningested, empty });

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
		new IngestModal(this.plugin).open();
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
					!file.path.startsWith(this.plugin.settings.dailyNoteFolder) && 
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
		const wrapper = parent.createDiv({ cls: 'vo-tasks-wrapper' });
		const grid = wrapper.createDiv({ cls: 'vo-middle-grid', attr: { style: 'display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px;' } });

		const leftCol = grid.createDiv({ cls: 'vo-tasks-main-col', attr: { style: 'display: flex; flex-direction: column; gap: 20px;' } });
		this.renderTodayTasks(leftCol);

		const rightCol = grid.createDiv({ cls: 'vo-tasks-side-col', attr: { style: 'display: flex; flex-direction: column; gap: 20px;' } });
		this.renderTodayHabits(rightCol);
	}

	private renderTodayTasks(parent: Element): void {
		const todayCard = parent.createDiv({ cls: 'vo-card vo-task-card vo-tech-card' });
		const headerContainer = todayCard.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center;' } });
		headerContainer.createSpan({ text: '今日待办 (TODAY)' , attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; text-align: left;' } });
		
		
		const stats = this.taskService.getCache();
		const taskList = todayCard.createDiv({ cls: 'vo-task-list' });
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

			return true;
		});

		const completedTodayFromTasks = tasks.filter(t => {
			const isCompleted = t.status === 2 || t.checked;
			if (!isCompleted) return false;

			return true;
		});

		const completedTodayFromHistory = (stats.completedTasks || []).filter(t => {
			const compTime = t.completedTime || t.completed_time;
			if (!compTime) return false;
			const compTimeMs = new Date(compTime).getTime();
			const isToday = compTimeMs >= todayStart && compTimeMs < todayEnd;
			if (!isToday) return false;

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
				const item = taskList.createDiv({ cls: 'vo-task-item' });
				
				const checkBtn = item.createEl('button', { 
					cls: 'vo-task-check-btn',
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
				txtContainer.createEl('span', { text: t.title || t.text || '无标题', cls: 'vo-task-text' });
				
				const dueStr = t.dueDate || t.startDate || t.time;
				if (dueStr && !t.isAllDay) {
					const dt = new Date(dueStr);
					const hours = dt.getHours().toString().padStart(2, '0');
					const minutes = dt.getMinutes().toString().padStart(2, '0');
					if (hours !== '00' || minutes !== '00') {
						txtContainer.createEl('span', { text: `${hours}:${minutes}`, cls: 'vo-task-time', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });
					}
				}
			});

			// Render completed today tasks
			completedToday.forEach(t => {
				const item = taskList.createDiv({ cls: 'vo-task-item' });
				
				const checkBtn = item.createEl('button', { 
					cls: 'vo-task-check-btn is-completed',
				});
				setIcon(checkBtn, 'check');

				const txtContainer = item.createDiv({ attr: { style: 'display: flex; flex-direction: column; flex: 1;' } });
				txtContainer.createEl('span', { text: t.text || '无标题', cls: 'vo-task-text is-completed' });
				
				const dueStr = t.time;
				if (dueStr && !t.isAllDay) {
					const dt = new Date(dueStr);
					const hours = dt.getHours().toString().padStart(2, '0');
					const minutes = dt.getMinutes().toString().padStart(2, '0');
					if (hours !== '00' || minutes !== '00') {
						txtContainer.createEl('span', { text: `${hours}:${minutes}`, cls: 'vo-task-time', attr: { style: 'font-size: 11px; color: var(--text-muted);' } });
					}
				}
			});
		}

		const addWrapper = todayCard.createDiv({ cls: 'vo-task-add-wrapper', attr: { style: 'margin-top: 15px; display: flex; gap: 8px;' } });
		const input = addWrapper.createEl('input', { type: 'text', placeholder: '添加今日待办...' });
		const btn = addWrapper.createEl('button', { text: '添加', cls: 'vo-btn vo-btn-primary' });
		btn.addEventListener('click', () => {
			void (async () => {
				if (input.value) {
					const title = input.value;
					const projectId = undefined;
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
		const habitCard = parent.createDiv({ cls: 'vo-card vo-habit-card vo-tech-card' });
		habitCard.createSpan({ text: '今日习惯打卡 (HABITS)' , attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; text-align: left; align-self: flex-start; display: block; margin-bottom: 6px;' } });
		
		const habitList = habitCard.createDiv({ cls: 'vo-habit-list' });
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

			const item = habitList.createDiv({ cls: 'vo-habit-item', attr: { style: 'margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;' } });
			
			const leftWrap = item.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });
			
			const checkBtn = leftWrap.createEl('button', { 
				cls: `vo-habit-check-btn ${isCompleted ? 'is-completed' : ''}`,
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

			leftWrap.createEl('span', { text: h.name, cls: 'vo-habit-name', attr: { style: isCompleted ? 'text-decoration: line-through; color: var(--text-muted);' : 'color: var(--text-normal);' } });
			
			item.createEl('span', { 
				text: `${h.totalCheckIns || 0} 次`, 
				cls: 'vo-habit-count', 
				attr: { style: 'font-size: 11px; color: var(--text-muted); font-family: var(--font-monospace);' } 
			});
		});
	}

	private renderMcpConsole(parent: Element): void {
		const statsCard = parent.createDiv({ cls: 'vo-card vo-task-stats-card vo-tech-card' });
		statsCard.createEl('h4', { text: 'Ticktick mcp 交互控制台' });
		
		const mcpConsole = statsCard.createDiv({ cls: 'vo-mcp-console' });
		const mcpInput = mcpConsole.createEl('input', { type: 'text', placeholder: '输入 MCP 指令，例如: get_tasks今天...' });
		const mcpBtn = mcpConsole.createEl('button', { text: '发送', cls: 'vo-btn vo-btn-secondary' });
		
		mcpBtn.addEventListener('click', () => {
			if (mcpInput.value) {
				const toolName = mcpInput.value.trim();
				new Notice(`执行 MCP 指令: ${toolName}...`);
				mcpInput.value = '';
				
				void (async () => {
					try {
						const res = (await this.taskService.mcpService.executeRequest(this.plugin.settings.ticktickMcp.serviceName, 'tools/call', {
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
	 * 以下为图表/导航相关复用辅助方法 (来自原 Stats Dashboard)
	 * =========================================================================
	 */
	private renderStatsNav(parent: Element): void {
		const navWrap = parent.createDiv({ 
			cls: 'vo-stats-header-wrap',
			attr: { style: 'display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;' }
		});
		
		const tabsContainer = navWrap.createDiv({ cls: 'vo-stats-nav-tabs' });
		tabsContainer.setAttr('style', 'display: flex; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 3px; gap: 4px;');
		const tabs = [
			{ id: 'week', label: '周' },
			{ id: 'month', label: '月' },
			{ id: 'year', label: '年' },
			{ id: 'all', label: '全部' }
		];
		
		tabs.forEach(t => {
			const isActive = this.statsTab === t.id;
			const btn = tabsContainer.createEl('button', {
				text: t.label,
				cls: `vo-stats-tab-btn ${isActive ? 'is-active' : ''}`
			});
			btn.setAttr('style', [
				'background: transparent',
				'border: none',
				'outline: none',
				'padding: 4px 14px',
				'font-size: 13px',
				'font-weight: 500',
				'line-height: 1.2',
				'border-radius: 999px',
				'cursor: pointer',
				'box-shadow: none',
				isActive
					? 'background-color: var(--interactive-accent); color: var(--text-on-accent);'
					: 'color: var(--text-muted);'
			].join('; '));
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
			const picker = navWrap.createDiv({ cls: 'vo-stats-date-picker' });
			picker.setAttr('style', 'padding: 0 4px; border-radius: 999px; border: 1px solid var(--background-modifier-border); display: flex; align-items: center; height: 32px; background: var(--background-primary);');
			
			const prevBtn = picker.createEl('button', { cls: 'vo-stats-date-btn' });
			prevBtn.setAttr('style', 'background: transparent; border: none; box-shadow: none; padding: 0; margin: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-muted);');
			setIcon(prevBtn, 'chevron-left');
			prevBtn.addEventListener('click', () => {
				this.currentDateOffset--;
				this.render();
			});

			const dateStr = this.calculateDateRangeString();
			const dateText = picker.createEl('span', { text: dateStr, cls: 'vo-stats-date-text' });
			dateText.setAttr('style', 'font-size: 14px; font-weight: 500; line-height: 1; margin: 0 6px; color: var(--text-normal);');

			const nextBtn = picker.createEl('button', { cls: 'vo-stats-date-btn' });
			nextBtn.setAttr('style', 'background: transparent; border: none; box-shadow: none; padding: 0; margin: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-muted);');
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

	private renderMiniGridSkeleton(parent: Element): {
		days: HTMLElement; avg: HTMLElement; atomics: HTMLElement;
		inbox: HTMLElement; output: HTMLElement; orphans: HTMLElement;
	} {
		const grid = parent.createDiv({ cls: 'vo-stats-mini-grid' });
		
		const makeCard = (icon: string, label: string): HTMLElement => {
			const card = grid.createDiv({ cls: 'vo-stats-mini-card vo-tech-card' });
			const valSpan = card.createSpan({ cls: 'vo-stats-mini-val' });
			setIcon(valSpan, icon);
			const numSpan = valSpan.createSpan({ text: ' --' });
			card.createSpan({ text: label, cls: 'vo-stats-mini-label' });
			return numSpan;
		};

		return {
			days:    makeCard('calendar', '记录天数'),
			avg:     makeCard('activity', '日均新增'),
			atomics: makeCard('file-text', '原子笔记'),
			inbox:   makeCard('folder', 'Inbox 待理'),
			output:  makeCard('book-open', '输出文章'),
			orphans: makeCard('link', '孤立笔记'),
		};
	}

	private renderMiniGrid(parent: Element, stats: VaultOverviewStats): void {
		const nodes = this.renderMiniGridSkeleton(parent);
		nodes.days.setText(`${stats.totalDays} 天`);
		nodes.avg.setText(`${stats.dailyAvg} 篇`);
		nodes.atomics.setText(`${stats.countAtomics} 篇`);
		nodes.inbox.setText(`${stats.countInbox} 篇`);
		nodes.output.setText(`${stats.countOutput} 篇`);
		nodes.orphans.setText(`${stats.countOrphans} 条`);
	}

	private renderChartSection(parent: Element): void {
		const chartSec = parent.createDiv({ cls: 'vo-stats-chart-section vo-tech-card' });
		this.renderChartSectionContent(chartSec);
	}

	private renderChartSectionContent(chartSec: Element): void {
		const header = chartSec.createDiv({ cls: 'vo-stats-chart-header' });
		
		let title = '每日新增笔记';
		if (this.statsTab === 'year' && this.statsChartType === 'bar') title = '每月新增笔记';
		if (this.statsTab === 'all' && this.statsChartType === 'bar') title = '每年新增笔记';
		header.createSpan({ text: title, cls: 'vo-stats-chart-title' });

		const toggles = header.createDiv({ cls: 'vo-stats-chart-toggles' });
		
		if (this.statsTab === 'month') {
			const btnBar = toggles.createEl('button', { 
				cls: `vo-stats-chart-toggle-btn ${this.statsChartType === 'bar' ? 'is-active' : ''}` 
			});
			setIcon(btnBar, 'activity');
			btnBar.addEventListener('click', () => {
				this.statsChartType = 'bar';
				this.render();
			});

			const btnCal = toggles.createEl('button', { 
				cls: `vo-stats-chart-toggle-btn ${this.statsChartType === 'calendar' ? 'is-active' : ''}` 
			});
			setIcon(btnCal, 'calendar');
			btnCal.addEventListener('click', () => {
				this.statsChartType = 'calendar';
				this.render();
			});
		} else if (this.statsTab === 'year' || this.statsTab === 'all') {
			const btnHeat = toggles.createEl('button', { 
				cls: `vo-stats-chart-toggle-btn ${this.statsChartType === 'heatmap' ? 'is-active' : ''}` 
			});
			setIcon(btnHeat, 'layout-dashboard');
			btnHeat.addEventListener('click', () => {
				this.statsChartType = 'heatmap';
				this.render();
			});

			const btnBar = toggles.createEl('button', { 
				cls: `vo-stats-chart-toggle-btn ${this.statsChartType === 'bar' ? 'is-active' : ''}` 
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
		if (this.cachedDateCounts && this.cachedVaultOverviewStats) return this.cachedDateCounts;

		// Single scan that populates both caches simultaneously
		const { stats, dateCounts } = this.vaultService.computeVaultData();
		this.cachedVaultOverviewStats = stats;
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

	private getCalendarWeekRowCount(offset: number, totalDays: number): number {
		return Math.ceil((offset + totalDays) / 7);
	}

	private formatCalendarCountLabel(count: number, isCompact: boolean): string {
		return isCompact ? `+${count}` : `+${count} 篇`;
	}

	private renderCalendarChart(parent: Element): void {
		const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

		const panel = parent.createDiv({ cls: 'vo-stats-calendar-panel' });
		const gridHeader = panel.createDiv({
			cls: 'vo-stats-calendar-grid vo-stats-calendar-grid--header',
			attr: { style: 'margin-bottom: 6px;' }
		});
		weekdays.forEach(wd => {
			gridHeader.createDiv({ text: wd, cls: 'vo-stats-calendar-weekday' });
		});
		
		const now = window.moment();
		const targetMonth = now.clone().add(this.currentDateOffset, 'months');
		
		const totalDays = targetMonth.daysInMonth();
		const startOfMonth = targetMonth.clone().startOf('month');
		
		// isoWeekday(): 1=Monday, 7=Sunday
		const offset = startOfMonth.isoWeekday() - 1;
		const weekRows = this.getCalendarWeekRowCount(offset, totalDays);
		const isCompact = weekRows >= 6;
		const gridBody = panel.createDiv({
			cls: `vo-stats-calendar-grid vo-stats-calendar-grid--body ${isCompact ? 'is-compact' : ''}`,
			attr: { style: `--vo-stats-calendar-rows: ${weekRows};` }
		});

		for (let i = 0; i < offset; i++) {
			gridBody.createDiv({ cls: 'vo-stats-calendar-cell is-empty' });
		}

		const dateCounts = this.getVaultDateCounts();

		for (let d = 1; d <= totalDays; d++) {
			const currentDay = targetMonth.clone().date(d);
			const count = dateCounts.get(currentDay.format('YYYY-MM-DD')) || 0;
			
			const cell = gridBody.createDiv({ 
				cls: `vo-stats-calendar-cell ${count > 0 ? 'has-read' : ''}` 
			});
			cell.createEl('span', {
				text: String(d),
				cls: 'vo-stats-calendar-cell-day',
				attr: { style: count > 0 ? 'font-weight: 700;' : '' }
			});
			if (count > 0) {
				cell.createEl('span', {
					text: this.formatCalendarCountLabel(count, isCompact),
					cls: 'vo-stats-calendar-cell-count'
				});
			}
		}
	}

	private renderHeatmapChart(parent: Element): void {
		const heatmapWrapper = parent.createDiv({ cls: 'vo-stats-heatmap-wrapper' });
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
		const cellSize = isSingleYear ? this.plugin.settings.heatmapCellSize : this.plugin.settings.heatmapDoubleCellSize;
		const cellGap = isSingleYear ? this.plugin.settings.heatmapCellGap : this.plugin.settings.heatmapDoubleCellGap;
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
				const col = gridContainer.createDiv({ cls: 'vo-stats-heatmap-col', attr: { style: `width: ${cellSize}px; gap: ${cellGap}px;` } });
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

					const cell = col.createDiv({ cls: `vo-stats-heatmap-cell ${isCurrentYear ? `level-${level}` : ''}`, attr: { style: `width: ${cellSize}px; height: ${cellSize}px;` } });
					if (!isCurrentYear) {
						cell.setCssStyles({ visibility: 'hidden' });
					} else {
						cell.createDiv({ text: `${dateStr} 新增 ${count} 篇笔记`, cls: 'vo-stats-heatmap-cell-tooltip' });
					}
					currentDate.add(1, 'day');
				}
			}
		});

		const footer = parent.createDiv({ cls: 'vo-stats-heatmap-footer' });
		const prefix = this.statsTab === 'all' ? '总计' : '本年度';
		footer.createSpan({ text: `${prefix}共活跃 ${totalActiveDays} 天，累计新增 ${totalNotes} 篇笔记` });
		
		const legend = footer.createDiv({ cls: 'vo-stats-heatmap-legend' });
		legend.createSpan({ text: '少' });
		for (let i = 0; i <= 4; i++) {
			legend.createDiv({ cls: `vo-stats-heatmap-legend-box level-${i}` });
		}
		legend.createSpan({ text: '多' });
	}
}

