import { ItemView, WorkspaceLeaf, Notice, setIcon, TFile, TFolder, moment, Modal, App, MarkdownRenderer } from 'obsidian';
import { Setting } from 'obsidian';
import VaultOsPlugin from './main';
import type { ClaudianAction } from './settings';
import { DiaryService } from './services/DiaryService';
import { VaultFileOperationService } from './services/VaultFileOperationService';
import { VaultHealthReportService } from './services/VaultHealthReportService';
import { ClaudianActionService } from './services/ClaudianActionService';
import { DailyReadingReflectionService } from './services/DailyReadingReflectionService';
import { DailyContextService } from './services/DailyContextService';
import { VaultService, VaultOverviewStats } from './services/VaultService';
import { WorkflowInspectionService } from './services/WorkflowInspectionService';
import { ObsidianWorkflowInspectionAdapter } from './adapters/ObsidianWorkflowInspectionAdapter';
import { buildMonthlyHealthReport, getMonthlyHealthReportFileName } from './domain/health-report';
import { isWorkflowInspectionSnapshot } from './domain/workflow-inspection-snapshot';
import { normalizeSmartActionCategories, requiresSmartActionInput, resolveSmartActionCategoryId } from './domain/smart-action';
import { chooseDailyReadingReflection } from './domain/daily-reflection';

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

export const VIEW_TYPE_VAULT_OS = 'vault-os-view';

interface DiagnosticListItem {
	path: string;
	detail?: string;
}

type ListModalItem = string | DiagnosticListItem;

class SimpleListModal extends Modal {
	private titleText: string;
	private items: ListModalItem[];
	
	constructor(app: App, titleText: string, items: ListModalItem[]) {
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
				const path = typeof item === 'string' ? item : item.path;
				const detail = typeof item === 'string' ? undefined : item.detail;
				
				let filePath = path;
				const match = path.match(/ in (.*)$/);
				if (match && match[1]) {
					filePath = match[1];
				}

				const a = li.createEl('a', {
					text: path,
					cls: 'internal-link',
					attr: { style: 'cursor: pointer; color: var(--text-accent); text-decoration: underline;' } 
				});
				a.onclick = () => {
					void this.app.workspace.openLinkText(filePath, '', true);
					this.close();
				};
				if (detail) li.createDiv({ text: detail, cls: 'setting-item-description' });
			});
		}
		
		const closeBtn = contentEl.createEl('button', { text: '关闭', cls: 'vo-btn vo-btn-secondary', attr: { style: 'float: right; margin-top: 15px;' } });
		closeBtn.onclick = () => this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class SmartActionInputModal extends Modal {
	constructor(
		app: App,
		private readonly action: ClaudianAction,
		private readonly onSubmit: (input: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('vo-smart-action-input-modal');
		contentEl.empty();
		contentEl.createEl('h2', { text: this.action.label });
		if (this.action.description) {
			contentEl.createEl('p', { text: this.action.description, cls: 'setting-item-description' });
		}
		contentEl.createEl('p', {
			text: '填写本次所需信息后，Vault OS 会将完整指令交给 Claudian。',
			cls: 'setting-item-description'
		});

		const input = contentEl.createEl('input', {
			type: 'text',
			placeholder: this.action.inputPlaceholder || '输入本次参数',
			cls: 'vo-smart-action-input'
		});
		const footer = contentEl.createDiv({ cls: 'vo-smart-action-input-footer' });
		const cancel = footer.createEl('button', { text: '取消' });
		const submit = footer.createEl('button', { text: '发送指令', cls: 'mod-cta' });
		const execute = () => {
			const value = input.value.trim();
			if (!value) {
				new Notice(this.action.inputPlaceholder ? `请先${this.action.inputPlaceholder}` : '请输入内容');
				input.focus();
				return;
			}
			this.onSubmit(value);
			this.close();
		};

		cancel.addEventListener('click', () => this.close());
		submit.addEventListener('click', execute);
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') execute();
		});
		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class EmptyNoteCleanupModal extends Modal {
	private candidates: TFile[] = [];
	private readonly selectedPaths = new Set<string>();

	constructor(
		app: App,
		private readonly vaultService: VaultService,
		private readonly fileOperations: VaultFileOperationService,
		private readonly onCompleted: (cleanedCount: number) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: '回收空白笔记' });
		this.contentEl.createEl('p', {
			text: '正在扫描候选文件。扫描完成前不会修改任何内容。',
			cls: 'setting-item-description'
		});
		void this.loadCandidates();
	}

	private async loadCandidates(): Promise<void> {
		this.candidates = await this.vaultService.getEmptyNoteFiles();
		this.selectedPaths.clear();
		for (const candidate of this.candidates) {
			this.selectedPaths.add(candidate.path);
		}
		this.renderPreview();
	}

	private renderPreview(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '回收空白笔记' });

		if (this.candidates.length === 0) {
			contentEl.createEl('p', { text: '没有发现可回收的空白笔记。' });
			const closeButton = contentEl.createEl('button', { text: '关闭' });
			closeButton.addEventListener('click', () => this.close());
			return;
		}

		contentEl.createEl('p', {
			text: `发现 ${this.candidates.length} 个候选文件。请确认范围；已选文件将移动到 Obsidian 回收站。`,
			cls: 'setting-item-description'
		});

		const selectionControls = contentEl.createDiv({ attr: { style: 'display: flex; gap: 8px; margin: 12px 0;' } });
		const selectAllButton = selectionControls.createEl('button', { text: '全选' });
		const clearSelectionButton = selectionControls.createEl('button', { text: '取消全选' });
		const list = contentEl.createDiv({ attr: { style: 'max-height: 300px; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 8px;' } });

		const footer = contentEl.createDiv({ attr: { style: 'margin-top: 16px;' } });
		let acknowledged = false;
		const acknowledgement = footer.createEl('label', { attr: { style: 'display: flex; align-items: center; gap: 8px; margin-bottom: 12px;' } });
		const acknowledgementCheckbox = acknowledgement.createEl('input', { type: 'checkbox' });
		acknowledgement.createSpan({ text: '我确认将所选文件移动到 Obsidian 回收站。' });
		const actions = footer.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; gap: 8px;' } });
		const cancelButton = actions.createEl('button', { text: '取消' });
		const confirmButton = actions.createEl('button', { text: '确认回收已选文件', cls: 'mod-warning' });

		const updateConfirmState = () => {
			confirmButton.disabled = !acknowledged || this.selectedPaths.size === 0;
			confirmButton.setText(`确认回收 ${this.selectedPaths.size} 个文件`);
		};

		const renderCandidates = () => {
			list.empty();
			for (const candidate of this.candidates) {
				const row = list.createEl('label', { attr: { style: 'display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer;' } });
				const checkbox = row.createEl('input', { type: 'checkbox' });
				checkbox.checked = this.selectedPaths.has(candidate.path);
				row.createSpan({ text: candidate.path });
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) this.selectedPaths.add(candidate.path);
					else this.selectedPaths.delete(candidate.path);
					updateConfirmState();
				});
			}
		};

		selectAllButton.addEventListener('click', () => {
			for (const candidate of this.candidates) this.selectedPaths.add(candidate.path);
			renderCandidates();
			updateConfirmState();
		});
		clearSelectionButton.addEventListener('click', () => {
			this.selectedPaths.clear();
			renderCandidates();
			updateConfirmState();
		});
		acknowledgementCheckbox.addEventListener('change', () => {
			acknowledged = acknowledgementCheckbox.checked;
			updateConfirmState();
		});
		cancelButton.addEventListener('click', () => this.close());
		confirmButton.addEventListener('click', () => void this.executeSelection(confirmButton, cancelButton));

		renderCandidates();
		updateConfirmState();
	}

	private async executeSelection(confirmButton: HTMLButtonElement, cancelButton: HTMLButtonElement): Promise<void> {
		confirmButton.disabled = true;
		cancelButton.disabled = true;
		const result = await this.fileOperations.trashConfirmedFiles(this.candidates, [...this.selectedPaths]);
		this.renderResult(result);
		this.onCompleted(result.succeededCount);
	}

	private renderResult(result: Awaited<ReturnType<VaultFileOperationService['trashConfirmedFiles']>>): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '空白笔记回收结果' });
		contentEl.createEl('p', {
			text: `已请求 ${result.requestedCount} 个文件：成功 ${result.succeededCount} 个，失败 ${result.failedCount} 个。`
		});

		if (result.failedCount > 0) {
			const failures = contentEl.createEl('ul');
			for (const item of result.items.filter(item => item.status === 'failed')) {
				failures.createEl('li', { text: `${item.path}: ${item.errorMessage || '未知错误'}` });
			}
		}

		const closeButton = contentEl.createEl('button', { text: '关闭' });
		closeButton.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class ArchiveNoteModal extends Modal {
	constructor(
		app: App,
		private readonly candidate: TFile,
		private readonly archiveFolder: string,
		private readonly fileOperations: VaultFileOperationService,
		private readonly onCompleted: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '确认归档笔记' });
		contentEl.createEl('p', { text: `源文件：${this.candidate.path}` });
		contentEl.createEl('p', { text: `目标目录：${this.archiveFolder || '未配置'}` });
		contentEl.createEl('p', {
			text: '归档会移动此文件。若目标存在同名文件，操作将停止且不会覆盖。',
			cls: 'setting-item-description'
		});

		const actions = contentEl.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;' } });
		const cancelButton = actions.createEl('button', { text: '取消' });
		const confirmButton = actions.createEl('button', { text: '确认归档', cls: 'mod-warning' });
		cancelButton.addEventListener('click', () => this.close());
		confirmButton.addEventListener('click', () => void this.archive(confirmButton, cancelButton));
	}

	private async archive(confirmButton: HTMLButtonElement, cancelButton: HTMLButtonElement): Promise<void> {
		confirmButton.disabled = true;
		cancelButton.disabled = true;
		const result = await this.fileOperations.archiveConfirmedFile(this.candidate, this.archiveFolder);
		this.contentEl.empty();
		this.contentEl.createEl('h2', { text: result.status === 'success' ? '归档完成' : '归档失败' });
		this.contentEl.createEl('p', { text: result.status === 'success' ? `已移动到：${result.targetPath}` : result.errorMessage || '归档失败' });
		const closeButton = this.contentEl.createEl('button', { text: '关闭' });
		closeButton.addEventListener('click', () => this.close());
		if (result.status === 'success') this.onCompleted();
	}

	onClose(): void {
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
	private fileOperations: VaultFileOperationService;
	private dashboardView: VaultOsView;
	
	constructor(app: App, vaultService: VaultService, fileOperations: VaultFileOperationService, dashboardView: VaultOsView) {
		super(app);
		this.vaultService = vaultService;
		this.fileOperations = fileOperations;
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
						
							const actionBtn = buttons.createEl('button', { text: '查看空白笔记候选', cls: 'vo-btn vo-btn-primary' });
							actionBtn.addEventListener('click', () => {
								this.close();
								new EmptyNoteCleanupModal(this.app, this.vaultService, this.fileOperations, (cleanedCount) => {
									this.dashboardView.updateCleanedEmpty(cleanedCount);
									if (cleanedCount > 0) new Notice(`已回收 ${cleanedCount} 篇空白笔记`);
								}).open();
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
	private readonly fileOperations: VaultFileOperationService;

	constructor(plugin: VaultOsPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.fileOperations = new VaultFileOperationService(plugin.app);
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
			
			// Archiving is high-impact and must remain an explicit, confirmed operation.
			const archiveBtn = actionGroup.createEl('button', { text: '归档', cls: 'vo-btn vo-btn-secondary' });
			archiveBtn.onclick = () => {
				this.close();
				new ArchiveNoteModal(this.app, file, this.plugin.settings.archiveFolder, this.fileOperations, () => {
					new Notice(`已归档 ${file.basename}`);
				}).open();
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
	
	// Primary workflow: start work, review periods, maintain the vault.
	private activeMainTab: 'home' | 'diary' | 'lint' | 'commands' = 'home';
	
	private statsTab: 'week' | 'month' | 'year' | 'all' = 'week';
	private statsChartType: 'bar' | 'calendar' | 'heatmap' = 'bar';
	private periodicTab: 'day' | 'week' | 'month' | 'quarter' | 'year' = 'day';
	private currentDateOffset = 0; // 0 表示当前周期，-1 前一周期，+1 后一周期
	private selectedPeriodicDate = moment();
	private lastScanTime = '尚未进行体检';
	private isScanning = false;
	private currentScanData: ScanData | null = null;

	private cachedVaultOverviewStats: VaultOverviewStats | null = null;
	private cachedDateCounts: Map<string, number> | null = null;
	private clearCacheTimer: number | null = null;

	private clearVaultStatsCache(): void {
		if (this.clearCacheTimer) window.clearTimeout(this.clearCacheTimer);
		this.clearCacheTimer = window.setTimeout(() => {
			this.cachedVaultOverviewStats = null;
			this.cachedDateCounts = null;
			if (this.activeMainTab === 'home') {
				this.render();
			}
		}, 300);
	}

	// 服务实例
	private diaryService: DiaryService;
	private vaultService: VaultService;
	private fileOperations: VaultFileOperationService;
	private healthReports: VaultHealthReportService;
	private claudianActions: ClaudianActionService;
	private dailyReflections: DailyReadingReflectionService;
	private dailyContext: DailyContextService;
	private workflowInspection: WorkflowInspectionService;
	private dailyReflectionOffset = 0;

	constructor(leaf: WorkspaceLeaf, plugin: VaultOsPlugin) {
		super(leaf);
		this.plugin = plugin;
		
		this.diaryService = new DiaryService(this.plugin);
		this.vaultService = new VaultService(this.plugin);
		this.fileOperations = new VaultFileOperationService(this.app);
		this.healthReports = new VaultHealthReportService(this.app);
		this.claudianActions = new ClaudianActionService(this.app);
		this.dailyReflections = new DailyReadingReflectionService(this.app);
		this.dailyContext = new DailyContextService(this.plugin);
		this.workflowInspection = new WorkflowInspectionService(this.plugin, new ObsidianWorkflowInspectionAdapter(this.app));
	}

	private calculateLintHealthScore(scanData: ScanData): number {
		const inboxDeduct = Math.min(25, scanData.inbox.count * 3);
		const diaryDeduct = Math.min(20, scanData.uningested.count * 2);
		const emptyDeduct = Math.min(15, scanData.empty.count * 2);
		const orphanDeduct = Math.min(25, Math.sqrt(scanData.orphans.count) * 4);
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

	triggerClaudianPrompt(prompt: string, input?: string): void {
		const settings = this.plugin.settings;
		void this.claudianActions.execute(prompt, {
			dailyPath: this.diaryService.getPeriodicRootFolder(),
			inboxPath: settings.inboxFolder,
			atomicsPath: settings.atomicsFolder,
			archivePath: settings.archiveFolder,
			outputPath: settings.outputFolder,
			input
		}).then(result => {
			if (result.status !== 'success') new Notice(result.message);
		});
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.vault.on('create', () => this.clearVaultStatsCache()));
		this.registerEvent(this.app.vault.on('delete', () => this.clearVaultStatsCache()));
		this.registerEvent(this.app.vault.on('modify', () => this.clearVaultStatsCache()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.clearVaultStatsCache()));

		this.render();
		
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
			attr: { style: 'border-bottom: 1px solid color-mix(in srgb, var(--background-modifier-border) 40%, transparent); padding-bottom: 10px; margin-bottom: 14px;' }
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
			attr: { style: 'font-size: 26px; font-weight: 600 !important; margin: 0; color: var(--text-normal); letter-spacing: 0.12em; font-family: var(--font-interface);' }
		});
		
		// 3. Right column: Metadata (uptime, version)
		const rightCol = headerRow.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex: 1;' } });
		const diffDays = this.vaultService.getVaultLifetimeDays();
		
		rightCol.createDiv({ 
			text: `SYS.v${this.plugin.manifest.version} // UPTIME.${diffDays}d`, 
			attr: { style: 'font-size: 10px; color: var(--text-muted); font-family: var(--font-monospace); font-weight: 400; letter-spacing: 0.5px; opacity: 0.8;' } 
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
			{ id: 'home', label: '首页', icon: 'home' },
			{ id: 'diary', label: '周期复盘', icon: 'calendar' },
			{ id: 'lint', label: '知识库体检', icon: 'shield-alert' },
			{ id: 'commands', label: '智能指令', icon: 'sparkles' }
		] as const;

		mainTabs.forEach(t => {
			const btn = tabWrapper.createEl('button', { 
				cls: `vo-viewport-tab-btn ${this.activeMainTab === t.id ? 'is-active' : ''}` 
			});
			setIcon(btn, t.icon);
			btn.createSpan({ text: ` ${t.label}` });
			btn.addEventListener('click', () => {
				this.activeMainTab = t.id;

				// Update tab button active states without full re-render
				tabWrapper.querySelectorAll('.vo-viewport-tab-btn').forEach((b, i) => {
					const tab = mainTabs[i];
					if (tab) b.toggleClass('is-active', tab.id === this.activeMainTab);
				});

				// Only replace content area
				contentWrapper.empty();
				this.renderTabContent(contentWrapper);

			});
		});

		const contentWrapper = parent.createDiv({ cls: 'vo-tab-content' });
		this.renderTabContent(contentWrapper);
	}

	private renderTabContent(contentWrapper: Element): void {
		contentWrapper.removeClass('vo-tab-content-fill');
		if (this.activeMainTab === 'home') {
			this.renderHomeDashboard(contentWrapper);
		} else if (this.activeMainTab === 'diary') {
			this.renderDiaryDashboard(contentWrapper);
		} else if (this.activeMainTab === 'commands') {
			this.renderSmartCommandsDashboard(contentWrapper);
		} else {
			this.renderLintDashboard(contentWrapper);
		}
	}

	private renderHomeDashboard(parent: Element): void {
		const container = parent.createDiv({ cls: 'vo-home-dashboard' });
		const today = moment();
		const header = container.createDiv({ cls: 'vo-home-hero' });
		const headerCopy = header.createDiv({ cls: 'vo-home-hero-copy' });
		headerCopy.createDiv({ text: 'DAILY QUOTE / 今日引言', cls: 'vo-home-eyebrow' });
		const dateContext = header.createDiv({ cls: 'vo-home-date-context' });
		const dateBadge = dateContext.createDiv({ cls: 'vo-home-date-badge' });
		dateBadge.createDiv({ text: today.format('ddd').toUpperCase(), cls: 'vo-home-date-weekday' });
		dateBadge.createDiv({ text: today.format('DD'), cls: 'vo-home-date-day' });
		dateBadge.createDiv({ text: today.format('YYYY.MM'), cls: 'vo-home-date-month' });
		this.renderHomeExternalContext(headerCopy, dateContext);

		const startSection = container.createDiv({ cls: 'vo-home-start-section' });
		const grid = startSection.createDiv({ cls: 'vo-home-start-grid' });
		const periodCard = grid.createDiv({ cls: 'vo-home-card vo-home-card-period' });
		const periodTopline = periodCard.createDiv({ cls: 'vo-home-card-topline' });
		periodTopline.createDiv({ text: '今日记录', cls: 'vo-home-card-label' });
		const periodIcon = periodTopline.createDiv({ cls: 'vo-home-card-icon' });
		setIcon(periodIcon, 'notebook-pen');
		const dailyTarget = this.diaryService.resolvePeriodicNotePath(today, 'day');
		const dailyFile = this.app.vault.getAbstractFileByPath(dailyTarget.filePath);
		periodCard.createDiv({ text: dailyFile instanceof TFile ? '今日日记已就绪' : '今日日记尚未创建', cls: 'vo-home-card-title' });
		periodCard.createDiv({ text: dailyTarget.fileName, cls: 'vo-home-card-detail' });
		const dailyButton = periodCard.createEl('button', { text: dailyFile instanceof TFile ? '打开今日日记' : '创建今日日记', cls: 'vo-btn vo-btn-primary vo-home-card-action' });
			dailyButton.addEventListener('click', () => {
				void (async () => {
					try {
						let path = dailyFile instanceof TFile ? dailyFile.path : '';
						if (!path) {
							const result = await this.diaryService.createTodayDiary();
							if (result.status === 'failed' || !result.path) throw new Error(result.errorMessage || '创建今日日记失败');
							path = result.path;
							if (result.warningMessage) new Notice(result.warningMessage);
						}
						void this.app.workspace.openLinkText(path, '', false);
					this.render();
				} catch {
					new Notice('无法创建今日日记，请检查周期笔记设置。');
				}
			})();
		});

		const reviewCard = grid.createDiv({ cls: 'vo-home-card' });
		const reviewTopline = reviewCard.createDiv({ cls: 'vo-home-card-topline' });
		reviewTopline.createDiv({ text: '周期复盘', cls: 'vo-home-card-label' });
		const reviewIcon = reviewTopline.createDiv({ cls: 'vo-home-card-icon' });
		setIcon(reviewIcon, 'calendar-days');
		reviewCard.createDiv({ text: '回到本周，整理已发生的事。', cls: 'vo-home-card-title' });
		reviewCard.createDiv({ text: '日 / 周 / 月 / 季 / 年记', cls: 'vo-home-card-detail' });
		const reviewButton = reviewCard.createEl('button', { text: '进入周期复盘', cls: 'vo-btn vo-btn-secondary vo-home-card-action' });
		reviewButton.addEventListener('click', () => {
			this.activeMainTab = 'diary';
			this.periodicTab = 'week';
			this.render();
		});

		const attentionCard = grid.createDiv({ cls: 'vo-home-card vo-home-attention-card' });
		this.renderHomeAttentionCard(attentionCard);

		this.renderDailyReflectionCard(container, today.format('YYYY-MM-DD'));
	}

	private renderHomeExternalContext(quoteParent: HTMLElement, weatherParent: HTMLElement): void {
		const settings = this.dailyContext.getSettings();
		if (!settings.weatherEnabled && !settings.quoteEnabled) return;
		if (settings.weatherEnabled && settings.weatherCity.trim()) {
			const weather = weatherParent.createDiv({ cls: 'vo-home-context-weather' });
			weather.createSpan({ text: '天气加载中…' });
			void this.dailyContext.getWeather().then(result => {
				if (!weather.isConnected || !result) return;
				weather.empty();
				const icon = weather.createSpan({ cls: 'vo-home-context-icon' });
				setIcon(icon, result.icon);
				weather.createSpan({ text: `${result.city} · ${result.condition} · ${result.temperature}°` });
			}).catch(() => {
				if (weather.isConnected) weather.setText('天气暂不可用');
			});
		}
		if (settings.quoteEnabled) {
			const quote = quoteParent.createDiv({ cls: 'vo-home-context-quote' });
			quote.createSpan({ text: '每日一句加载中…' });
			void this.dailyContext.getQuote().then(result => {
				if (!quote.isConnected || !result) return;
				quote.empty();
				quote.createDiv({ text: `“${result.text}”`, cls: 'vo-home-context-quote-text' });
				const attribution = quote.createDiv({ cls: 'vo-home-context-quote-attribution' });
				attribution.createSpan({ text: `— ${result.author}` });
				const source = attribution.createEl('a', { text: result.provider, href: result.url, cls: 'external-link', attr: { target: '_blank', rel: 'noopener noreferrer' } });
				source.setAttr('aria-label', `${result.provider} 来源`);
			}).catch(() => {
				if (quote.isConnected) quote.setText('每日一句暂不可用');
			});
		}
	}

	private renderDailyReflectionCard(parent: HTMLElement, dayKey: string): void {
		const card = parent.createDiv({ cls: 'vo-home-reflection-card' });
		const header = card.createDiv({ cls: 'vo-home-reflection-header' });
		const label = header.createDiv({ cls: 'vo-home-reflection-label' });
		const icon = label.createDiv({ cls: 'vo-home-card-icon' });
		setIcon(icon, 'quote');
		label.createDiv({ text: '每日阅读回看', cls: 'vo-home-section-title' });
		const controls = header.createDiv({ cls: 'vo-home-reflection-controls' });
		const rotateButton = controls.createEl('button', { text: '换一条', cls: 'vo-btn vo-btn-secondary vo-home-reflection-rotate' });
		rotateButton.disabled = !this.plugin.settings.readingReflectionScope;
		const body = card.createDiv({ cls: 'vo-home-reflection-body' });

		if (!this.plugin.settings.readingReflectionScope) {
			body.createDiv({ text: '尚未配置阅读回看范围。请在设置的“看板基础设置”中选择读书笔记文件夹、标签或属性规则。', cls: 'vo-home-empty-state' });
			return;
		}
		body.createDiv({ text: '正在读取你的阅读感想…', cls: 'vo-home-empty-state' });
		const renderReflection = () => {
		void this.dailyReflections.getReflections(this.plugin.settings.readingReflectionScope).then(async reflections => {
				if (!body.isConnected) return;
				body.empty();
				const reflection = chooseDailyReadingReflection(reflections, dayKey, this.dailyReflectionOffset);
				if (!reflection) {
					body.createDiv({ text: '此范围内还没有带个人想法、笔记或感想的阅读块。纯划线会保持安静，不进入每日回看。', cls: 'vo-home-empty-state' });
					return;
				}
				const reflectionContent = body.createDiv({ cls: 'vo-home-reflection-text markdown-rendered' });
				await MarkdownRenderer.render(this.app, reflection.reflection, reflectionContent, reflection.filePath, this);
				if (reflection.quote) {
					const quoteContent = body.createDiv({ cls: 'vo-home-reflection-quote markdown-rendered' });
					await MarkdownRenderer.render(this.app, reflection.quote, quoteContent, reflection.filePath, this);
				}
				const meta = body.createDiv({ cls: 'vo-home-reflection-meta' });
				meta.createSpan({ text: reflection.bookTitle });
				meta.createSpan({ text: reflection.chapterTitle });
				if (reflection.createdAt) meta.createSpan({ text: reflection.createdAt });
				const openButton = body.createEl('button', { text: '回到原文', cls: 'vo-btn vo-btn-secondary vo-home-reflection-open' });
				openButton.addEventListener('click', () => this.dailyReflections.openReflection(reflection));
			}).catch(() => {
				if (!body.isConnected) return;
				body.empty();
				body.createDiv({ text: '无法读取阅读回看内容，请检查范围与 Markdown 格式。', cls: 'vo-home-empty-state' });
			});
		};
		rotateButton.addEventListener('click', () => {
			this.dailyReflectionOffset++;
			renderReflection();
		});
		renderReflection();
	}

	private renderHomeAttentionCard(card: HTMLElement): void {
		const header = card.createDiv({ cls: 'vo-home-card-topline' });
		header.createDiv({ text: '需要注意', cls: 'vo-home-card-label' });
		const icon = header.createDiv({ cls: 'vo-home-card-icon' });
		setIcon(icon, 'shield-check');
		const content = card.createDiv({ cls: 'vo-home-attention-content' });
		content.createDiv({ text: '正在检查…', cls: 'vo-home-card-detail' });
		void Promise.all([
			this.vaultService.getInboxBacklog(),
			this.vaultService.getDeadLinkCount(),
			this.vaultService.getEmptyNotesCount()
		]).then(([inbox, deadLinks, empty]) => {
			if (!content.isConnected) return;
			content.empty();
			const messages = [
				inbox.count > 0 ? `Inbox 待处理 ${inbox.count} 项` : '',
				deadLinks.count > 0 ? `死链 ${deadLinks.count} 项` : '',
				empty.count > 0 ? `空白笔记 ${empty.count} 项` : ''
			].filter(Boolean);
			content.createDiv({ text: messages.length ? messages.join(' · ') : '当前没有需要立即处理的体检问题。', cls: 'vo-home-card-title' });
			const button = card.createEl('button', { text: messages.length ? '查看体检问题' : '打开知识库体检', cls: 'vo-btn vo-btn-secondary vo-home-card-action' });
			button.addEventListener('click', () => {
				this.activeMainTab = 'lint';
				this.render();
			});
		}).catch(() => {
			if (!content.isConnected) return;
			content.empty();
			content.createDiv({ text: '体检摘要暂不可用。', cls: 'vo-home-card-title' });
		});
	}

	private createHomeMetric(parent: HTMLElement, label: string): HTMLElement {
		const metric = parent.createDiv({ cls: 'vo-home-metric' });
		const value = metric.createDiv({ text: '—', cls: 'vo-home-metric-value' });
		metric.createDiv({ text: label, cls: 'vo-home-metric-label' });
		return value;
	}

	/**
	 * =========================================================================
	 * 01 / 仓库主频道渲染
	 * =========================================================================
	 */
	

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
			cls: 'vo-dashboard-grid vo-diary-grid vo-workspace-dashboard vo-diary-workspace',
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
			const result = await this.diaryService.createPeriodicNote(date, cycle);
			if (result.status === 'failed' || !result.path) {
				new Notice(`创建笔记失败: ${result.errorMessage || '未知错误'}`);
				return;
			}
			if (result.warningMessage) new Notice(result.warningMessage);
			new Notice(result.status === 'existing' ? `笔记已存在：${fileName}` : `已成功创建笔记：${fileName}`);
			void this.app.workspace.openLinkText(result.path, '', false);
			this.render();
		}
	}

	private renderPeriodicNotesPanel(parent: Element): void {
		const card = parent.createDiv({ cls: 'vo-card vo-periodic-card vo-tech-card vo-workspace-card vo-diary-periodic-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;' } });
		const header = card.createDiv({ cls: 'vo-card-header vo-workspace-card-header', attr: { style: 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;' } });

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

		const datePicker = header.createDiv({ cls: 'vo-workspace-date-picker', attr: { style: 'display: flex; align-items: center; gap: 4px;' } });
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
				cls: 'vo-periodic-grid vo-periodic-day-grid',
				attr: { style: 'display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; width: 100%;' } 
			});
			const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
			weekdays.forEach(wd => {
				grid.createDiv({ text: wd, cls: 'vo-periodic-weekday', attr: { style: 'text-align: center; font-size: 11px; color: var(--text-muted); font-weight: 600; padding-bottom: 4px;' } });
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
		const diaryCard = parent.createDiv({ cls: 'vo-card vo-diary-card vo-tech-card vo-workspace-card vo-diary-current-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;' } });
		
		const tabNames: Record<string, string> = {
			'day': '日记', 'week': '周记', 'month': '月记', 'quarter': '季记', 'year': '年记'
		};
		const currentName = tabNames[this.periodicTab] || '日记';

		const header = diaryCard.createDiv({ cls: 'vo-card-header vo-workspace-card-header', attr: { style: 'display: flex; align-items: center; width: 100%; text-align: left;' } });
		const headerIcon = header.createDiv({ cls: 'vo-workspace-card-icon' });
		setIcon(headerIcon, 'notebook-pen');
		header.createSpan({ text: this.getPeriodicCardTitle(), cls: 'vo-workspace-card-label', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; text-align: left; align-self: flex-start;' } });
		
		const baseDate = this.getPeriodicBaseDate();
		const { filePath } = this.diaryService.resolvePeriodicNotePath(baseDate, this.periodicTab);
		
		const content = diaryCard.createDiv({ cls: 'vo-diary-content', attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; margin-top: 12px; min-height: 0;' } });
		
		const file = this.app.vault.getAbstractFileByPath(filePath);
		const isCreated = file instanceof TFile;

		const borderStyle = isCreated ? '1px solid var(--interactive-accent)' : '1px dashed var(--background-modifier-border)';
		const innerDiv = content.createDiv({ cls: `vo-diary-note-surface ${isCreated ? 'is-created' : 'is-missing'}`, attr: { style: `border: ${borderStyle}; border-radius: 8px; padding: 12px; flex-grow: 1; display: flex; flex-direction: column; min-height: 0;` } });
		
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
			cls: 'vo-btn vo-btn-secondary vo-workspace-action',
			attr: { style: 'width: 100%; margin-top: 15px;' }
		});
		
		openBtn.onclick = () => {
			void (async () => {
					if (!isCreated) {
						const result = await this.diaryService.createPeriodicNote(baseDate, this.periodicTab);
						if (result.status === 'failed' || !result.path) {
							new Notice(`创建${currentName}失败: ${result.errorMessage || '未知错误'}`);
							return;
						}
						if (result.warningMessage) new Notice(result.warningMessage);
						new Notice(result.status === 'existing' ? `${currentName}已存在` : `成功创建${currentName}`);
						void this.app.workspace.openLinkText(result.path, '', false);
						this.render();
				} else {
					void this.app.workspace.openLinkText(filePath, '', false);
				}
			})();
		};
	}

	private async renderDiaryStatsCard(parent: Element): Promise<void> {
		const card = parent.createDiv({ cls: 'vo-card vo-tech-card vo-workspace-card vo-diary-stats-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;' } });
		const header = card.createDiv({ cls: 'vo-card-header vo-workspace-card-header' });
		const headerIcon = header.createDiv({ cls: 'vo-workspace-card-icon' });
		setIcon(headerIcon, 'chart-no-axes-column');
		header.createSpan({ text: '日记数据概览 (DIARY STATS)', cls: 'vo-workspace-card-label', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; text-align: left; align-self: flex-start;' } });

		const content = card.createDiv({ cls: 'vo-diary-stat-grid', attr: { style: 'flex-grow: 1; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 4px 0; align-content: center; overflow-y: auto;' } });
		content.createDiv({ text: '分析中...', attr: { style: 'color: var(--text-muted); font-size: 13px; grid-column: span 2; text-align: center;' } });

		try {
			const stats = await this.diaryService.getDiaryStats();
			content.empty();

			const createStatItem = (label: string, value: string | number, highlight = false) => {
				const item = content.createDiv({ cls: `vo-diary-stat-item ${highlight ? 'is-highlighted' : ''}`, attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--background-secondary); border: 1px solid color-mix(in srgb, var(--background-modifier-border) 60%, transparent); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02); padding: 8px 8px; border-radius: 8px; transition: transform 0.2s;' } });
				item.createDiv({ text: String(value), cls: 'vo-diary-stat-value', attr: { style: `font-size: ${highlight ? '18px' : '15px'}; font-weight: 700; font-family: var(--font-monospace); color: ${highlight ? 'var(--interactive-accent)' : 'var(--text-normal)'}; margin-bottom: 2px; text-align: center;` } });
				item.createDiv({ text: label, cls: 'vo-diary-stat-label', attr: { style: 'font-size: 11px; color: var(--text-muted); font-weight: 500; text-align: center;' } });
			};

			createStatItem('累计日记', stats.totalDiaries);
			createStatItem('总记录天数', stats.totalDays);
			createStatItem('周 / 月 / 季 / 年', `${stats.totalWeeklies} / ${stats.totalMonthlies} / ${stats.totalQuarterlies} / ${stats.totalYearlies}`);
			createStatItem('连续打卡 (天)', stats.maxStreak, true);
			createStatItem('累积字数 (约)', stats.totalWords);

		} catch {
			content.empty();
			content.createDiv({ text: '统计失败', attr: { style: 'color: var(--text-muted); font-size: 13px; grid-column: span 2; text-align: center;' } });
		}
	}

	private async renderLastYearPreviewCard(parent: Element): Promise<void> {
		const card = parent.createDiv({ cls: 'vo-card vo-tech-card vo-workspace-card vo-diary-memory-card', attr: { style: 'height: 100%; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;' } });
		const header = card.createDiv({ cls: 'vo-card-header vo-workspace-card-header' });
		
		const baseDate = this.getPeriodicBaseDate();
		const targetLabel = this.periodicTab === 'day' ? '去年今日' : 
							this.periodicTab === 'year' ? '去年' : 
							`去年同${this.periodicTab === 'week' ? '周' : this.periodicTab === 'month' ? '月' : '季'}`;
		
		const headerIcon = header.createDiv({ cls: 'vo-workspace-card-icon' });
		setIcon(headerIcon, 'history');
		header.createSpan({ text: `${targetLabel}回望 (MEMORY)`, cls: 'vo-workspace-card-label', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px; text-align: left; align-self: flex-start;' } });

		const content = card.createDiv({ attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 12px; padding: 8px 0; min-height: 0;' } });
		
		const innerDiv = content.createDiv({ attr: { style: 'flex-grow: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0;' } });
		innerDiv.createDiv({ text: '查询中...', attr: { style: 'color: var(--text-muted); font-size: 13px; text-align: center;' } });

		try {
			const info = await this.diaryService.getLastYearNote(baseDate, this.periodicTab);
			innerDiv.empty();

			if (info) {
				innerDiv.setAttr('style', 'border: 1px solid var(--interactive-accent); border-radius: 8px; padding: 12px; flex-grow: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0;');
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

			const btn = content.createEl('button', { cls: 'vo-btn vo-btn-primary vo-workspace-action', attr: { style: 'width: 100%; margin-top: auto;' } });
			btn.createSpan({ text: `打开${targetLabel}` });
			btn.addEventListener('click', () => {
				void (async () => {
					const targetDate = baseDate.clone().subtract(1, 'year');
					const { filePath } = this.diaryService.resolvePeriodicNotePath(targetDate, this.periodicTab);
					const file = this.app.vault.getAbstractFileByPath(filePath);
						if (file instanceof TFile) {
							void this.app.workspace.openLinkText(filePath, '', false);
						} else {
							const result = await this.diaryService.createPeriodicNote(targetDate, this.periodicTab);
							if (result.status === 'failed' || !result.path) {
								new Notice(`创建${targetLabel}失败: ${result.errorMessage || '未知错误'}`);
								return;
							}
							if (result.warningMessage) new Notice(result.warningMessage);
							new Notice(result.status === 'existing' ? `${targetLabel}已存在` : `成功创建${targetLabel}`);
							void this.app.workspace.openLinkText(result.path, '', false);
							this.render();
					}
				})();
			});

		} catch {
			innerDiv.empty();
			innerDiv.createDiv({ text: '查询失败', attr: { style: 'color: var(--text-muted); font-size: 13px; text-align: center;' } });
		}
	}



	/**
	 * =========================================================================
	 * 03 / 巡检主频道渲染
	 * =========================================================================
	 */
	private renderLintDashboard(parent: Element): void {
		parent.empty();
		parent.addClass('vo-workspace-dashboard', 'vo-lint-workspace');

		const workflowCard = parent.createDiv({ cls: 'vo-card vo-tech-card vo-workspace-card vo-workflow-diagnostics-card' });
		const workflowHeader = workflowCard.createDiv({ cls: 'vo-workspace-card-header' });
		const workflowIcon = workflowHeader.createDiv({ cls: 'vo-workspace-card-icon' });
		setIcon(workflowIcon, 'waypoints');
		workflowHeader.createSpan({ text: '工作流诊断', cls: 'vo-workflow-diagnostics-title' });
		const workflowControls = workflowHeader.createDiv({ cls: 'vo-workflow-diagnostics-controls' });
		const workflowTrend = workflowControls.createSpan({ cls: 'vo-workflow-diagnostics-trend' });
		const snapshotButton = workflowControls.createEl('button', { text: '保存当前基线', cls: 'vo-btn vo-btn-secondary vo-workspace-action vo-workflow-snapshot-button' });
		const workflowContent = workflowCard.createDiv({ cls: 'vo-workflow-diagnostics-content', text: '正在确认安全范围与工作流状态…' });
		const renderWorkflowInspection = () => {
			const result = this.workflowInspection.inspect();
			workflowContent.empty();
			if (result.status === 'blocked') {
				workflowCard.addClass('is-attention');
				workflowTrend.setText('安全范围未确认');
				snapshotButton.disabled = true;
				workflowContent.createEl('p', { text: result.reason || '语义巡检已安全停止。' });
				workflowContent.createEl('p', { text: '请在“仓库规则”中确认至少一个按文件夹排除的全局安全范围后再运行。', cls: 'setting-item-description' });
				return;
			}
			workflowCard.removeClass('is-attention');
			const savedSnapshot = this.plugin.settings.workflowInspectionSnapshot;
			const snapshot = isWorkflowInspectionSnapshot(savedSnapshot) ? savedSnapshot : undefined;
			const diff = this.workflowInspection.compareWithSnapshot(result, snapshot);
			const trendText = !snapshot
				? '暂无历史基线'
				: !diff.comparable
					? '当前诊断规则已变化，暂无可比历史基线'
					: `相对 ${snapshot.capturedAt.slice(0, 16).replace('T', ' ')}：新增 ${diff.current.filter(issue => issue.status === 'new').length} · 持续 ${diff.current.filter(issue => issue.status === 'persistent').length} · 已解决 ${diff.resolved.length}`;
			workflowTrend.setText(trendText);
			snapshotButton.setText(snapshot ? '更新基线' : '保存基线');
			snapshotButton.disabled = false;
			const knowledgeGraphConfigured = result.knowledgeGraph.status === 'configured';
			const groups: Array<{ title: string; description: string; items: Array<{ label: string; title: string; entries: DiagnosticListItem[]; emptyMessage: string }> }> = [
				{
					title: '问题与判断', description: 'Question → Claim', items: !knowledgeGraphConfigured ? [
						{ label: '知识实体契约：未配置', title: 'Question、Claim、Evidence 的识别规则', entries: [], emptyMessage: '请在“仓库规则”中应用当前仓库的工作流兼容映射，或配置自己的知识实体契约。' }
					] : [
						{ label: `Question 关联候选：${result.knowledgeGraph.questionsWithoutClaimLinks.length} 项`, title: '尚未与 Claim 建立双链的 Question（候选）', entries: result.knowledgeGraph.questionsWithoutClaimLinks.map(path => ({ path, detail: '未发现该 Question 指向 Claim，或任一 Claim 指回该 Question。' })), emptyMessage: '当前所有 Question 都已与至少一个 Claim 建立双链。' },
						{ label: `活跃 Claim 待证：${result.activeClaimEvidenceDebt.length} 项`, title: '被 Project 或 Output 使用、但缺少 Evidence 的 Claim', entries: result.activeClaimEvidenceDebt.map(issue => ({ path: issue.claimPath, detail: `使用来源：${issue.usagePaths.join('、')}；未发现 Evidence.supports 指向此 Claim。` })), emptyMessage: '当前所有活跃 Claim 都已有结构化 Evidence。' }
					]
				},
				{
					title: '证据与输出', description: 'Evidence → Output', items: !knowledgeGraphConfigured ? [
						{ label: '证据与输出：等待实体契约', title: 'Evidence 与 Output 的关系规则', entries: [], emptyMessage: '请先配置 Question、Claim、Evidence 的实体契约后再查看知识链路诊断。' }
					] : [
						{ label: `Evidence 未挂接：${result.knowledgeGraph.evidenceWithoutSupports.length} 项`, title: '缺少 supports 的 Evidence', entries: result.knowledgeGraph.evidenceWithoutSupports.map(path => ({ path, detail: 'Evidence 未声明 supports；此为结构候选，不评价证据质量。' })), emptyMessage: '当前所有 Evidence 都已声明 supports。' },
						{ label: `Evidence supports 格式异常：${result.knowledgeGraph.evidenceWithInvalidSupports.length} 项`, title: 'supports 格式无效的 Evidence', entries: result.knowledgeGraph.evidenceWithInvalidSupports.map(path => ({ path, detail: 'supports 必须是 Wiki 链接字符串或字符串数组；当前值无法被安全解析。' })), emptyMessage: '当前没有格式无效的 supports。' },
						{ label: `Evidence supports 失效：${result.knowledgeGraph.evidenceWithUnresolvedSupports.length} 项`, title: 'supports 指向不存在目标的 Evidence', entries: result.knowledgeGraph.evidenceWithUnresolvedSupports.map(path => ({ path, detail: 'supports 中至少一个 Wiki 链接无法解析到现有文件。' })), emptyMessage: '当前所有 declared supports 都能解析到现有文件。' },
						{ label: `Evidence supports 非 Claim：${result.knowledgeGraph.evidenceWithNonClaimSupports.length} 项`, title: 'supports 指向非 Claim 的 Evidence', entries: result.knowledgeGraph.evidenceWithNonClaimSupports.map(issue => ({ path: issue.evidencePath, detail: `supports 只能指向 Claim；当前目标：${issue.targets.map(target => {
							const kind = target.kind === 'outside-knowledge' ? '不在知识范围' : target.kind === 'unclassified' ? '未分类' : target.kind;
							const properties = [target.entityProperties?.type && `type=${target.entityProperties.type}`, target.entityProperties?.cardType && `card_type=${target.entityProperties.cardType}`].filter(Boolean).join('，');
							return `${target.path}（${kind}${properties ? `；读取到 ${properties}` : ''}）`;
						}).join('、')}。` })), emptyMessage: '当前所有 supports 目标都是 Claim。' },
						{ label: `Output 论证候选：${result.knowledgeGraph.outputsWithoutClaimLinks.length} 项`, title: '尚未链接 Claim 的 Output（候选）', entries: result.knowledgeGraph.outputsWithoutClaimLinks.map(path => ({ path, detail: '未发现该 Output 出链至已配置的 Claim 实体。' })), emptyMessage: '当前所有 Output 实体都已链接至少一个 Claim。' }
					]
				},
				{
					title: '项目与回流', description: 'Project → Review', items: [
						{ label: `已完成但仍在 Projects：${result.completedProjectPaths.length} 项`, title: '待确认回流或归档的 Project', entries: result.completedProjectPaths.map(path => ({ path, detail: '已识别为 Project 实体，状态已归一化为 completed，仍位于已配置的 Projects 范围。' })), emptyMessage: '当前没有待确认回流或归档的 Project。' },
						{
							label: result.p0ClaimEvidence === 'unconfigured' ? 'P0 Claim 优先级：未配置' : `P0 Claim 待证：${result.p0ClaimDebt.length} 项`,
							title: '需要补齐 Evidence 的 P0 Claim', entries: result.p0ClaimDebt.map(issue => ({ path: issue.claimPath, detail: `使用来源：${issue.usagePaths.join('、')}；符合 P0 规则，且未发现 Evidence.supports。` })),
							emptyMessage: result.p0ClaimEvidence === 'unconfigured' ? '请先在“仓库规则”中定义哪些 Claim 属于 P0，再启用优先级队列。' : '当前所有 P0 Claim 都已有结构化 Evidence。'
						},
						{
							label: result.outputLifecycle === 'unconfigured' ? 'Output 生命周期：不可判定（未配置）' : `已发布但未复盘的 Output：${result.publishedUnreviewedOutputPaths.length} 项`,
							title: '待复盘的 Output', entries: result.publishedUnreviewedOutputPaths.map(path => ({ path, detail: 'Output 状态命中“已发布”，未命中“已复盘”状态。' })),
							emptyMessage: result.outputLifecycle === 'unconfigured' ? '请先配置 Output 实体入口、已发布状态和已复盘状态。' : '当前没有待复盘的 Output。'
						}
					]
				}
			];
			for (const group of groups) {
				const groupEl = workflowContent.createDiv({ cls: 'vo-workflow-diagnostics-group' });
				const groupTitleLine = groupEl.createDiv({ cls: 'vo-workflow-diagnostics-group-title-line' });
				groupTitleLine.createSpan({ text: group.title, cls: 'vo-workflow-diagnostics-group-title' });
				groupTitleLine.createSpan({ text: `(${group.description})`, cls: 'vo-workflow-diagnostics-group-relation' });
				for (const item of group.items) {
					const button = groupEl.createEl('button', { text: item.label, cls: 'vo-workflow-diagnostics-item vo-workflow-diagnostics-button' });
					button.addEventListener('click', () => {
						if (item.entries.length > 0) new SimpleListModal(this.app, item.title, item.entries).open();
						else new Notice(item.emptyMessage);
					});
				}
			}
		};
		snapshotButton.addEventListener('click', () => {
			const result = this.workflowInspection.inspect();
			if (result.status === 'blocked') return;
			this.plugin.settings.workflowInspectionSnapshot = this.workflowInspection.captureSnapshot(result);
			void this.plugin.saveSettings().then(() => {
				renderWorkflowInspection();
				new Notice('已保存工作流诊断快照。');
			});
		});
		renderWorkflowInspection();

		const grid = parent.createDiv({ cls: 'vo-middle-grid vo-lint-overview-grid', attr: { style: 'display: grid; grid-template-columns: 1fr 1.6fr; align-items: stretch; gap: 16px; margin-bottom: 12px;' } });

		const leftCard = grid.createDiv({ cls: 'vo-card vo-tech-card vo-workspace-card vo-lint-health-card', attr: { style: 'text-align: center; display: flex; flex-direction: column; align-items: stretch; padding: 10px; min-height: 0; gap: 6px;' } });
		const microHeaderLeft = leftCard.createDiv({ cls: 'vo-workspace-card-header', attr: { style: 'display: flex; align-items: center; gap: 8px; text-align: left; align-self: flex-start; width: 100%; margin-bottom: 0;' } });
		const healthHeaderIcon = microHeaderLeft.createDiv({ cls: 'vo-workspace-card-icon' });
		setIcon(healthHeaderIcon, 'shield-check');
		const healthHeaderText = microHeaderLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 1px; min-width: 0;' } });
		healthHeaderText.createSpan({ text: '仓库健康度 (HEALTH)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px;' } });
		healthHeaderText.createSpan({ text: '基于 Inbox、死链、孤儿和空白笔记综合评估', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.6;' } });

		const ringContainer = leftCard.createDiv({ cls: 'vo-progress-ring-container', attr: { style: 'margin: 8px auto; position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center;' } });
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

		const statusInfoDiv = leftCard.createDiv({ attr: { style: 'margin: 2px 0; font-size: 11px; color: var(--text-muted); font-family: var(--font-monospace);' } });
		const scanTimeSpan = statusInfoDiv.createDiv({ text: `上次体检: ${this.lastScanTime}` });
		const statusText = leftCard.createEl('p', {
			text: this.isScanning ? '正在体检中...' : '检测就绪，建议定期巡检优化。',
			attr: { style: 'font-size: 12px; color: var(--text-muted); margin: 2px 0;' }
		});

		const btnGroup = leftCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 2px;' } });
		const runBtn = btnGroup.createEl('button', {
			cls: 'vo-btn vo-btn-secondary vo-workspace-action',
			attr: { style: 'width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;' }
		});
		setIcon(runBtn, 'play');
		runBtn.createSpan({ text: '开始体检' });

		const rightCard = grid.createDiv({ cls: 'vo-card vo-tech-card vo-workspace-card vo-lint-diagnostics-card', attr: { style: 'padding: 10px; display: flex; flex-direction: column; justify-content: flex-start; min-height: 280px; gap: 8px;' } });
		
		const rightCardHeader = rightCard.createDiv({ cls: 'vo-workspace-card-header', attr: { style: 'display: flex; justify-content: space-between; align-items: flex-start; width: 100%; margin: 0;' } });
		const diagnosticsHeaderIcon = rightCardHeader.createDiv({ cls: 'vo-workspace-card-icon' });
		setIcon(diagnosticsHeaderIcon, 'radar');
		rightCardHeader.createSpan({ text: '诊断面板 (DIAGNOSTICS)', attr: { style: 'font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 600; letter-spacing: 0.5px;' } });
		
		const reportBtn = rightCardHeader.createEl('button', { cls: 'icon-btn', attr: { title: '打开最近一次体检报告', style: 'background: transparent; border: none; box-shadow: none; cursor: pointer; padding: 0; color: var(--text-muted); line-height: 1;' } });
		setIcon(reportBtn, 'file-text');
		reportBtn.addEventListener('click', () => {
			const outputFolder = this.app.vault.getAbstractFileByPath(this.plugin.settings.outputFolder);
			if (outputFolder instanceof TFolder) {
				const reportFiles = outputFolder.children.filter((f): f is TFile => 
					f instanceof TFile && f.name.endsWith('知识库体检报告.md')
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
		const topLogContainer = rightCard.createDiv({ cls: 'vo-lint-metric-grid', attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; flex-shrink: 0;' } });
		
		const inboxItem = topLogContainer.createDiv({ cls: 'vo-lint-metric-item', attr: { style: 'justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const inboxLeft = inboxItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const inboxIconEl = inboxLeft.createDiv(); setIcon(inboxIconEl, 'inbox');
		const inboxTextWrap = inboxLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 0;' } });
		inboxTextWrap.createSpan({ text: '待分类文件', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const inboxDesc = inboxTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		const diaryItem = topLogContainer.createDiv({ cls: 'vo-lint-metric-item', attr: { style: 'justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const diaryLeft = diaryItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 6px;' } });
		const diaryIconEl = diaryLeft.createDiv(); setIcon(diaryIconEl, 'calendar');
		const diaryTextWrap = diaryLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 0;' } });
		diaryTextWrap.createSpan({ text: '待入库日记', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const diaryDesc = diaryTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		// Inspect layout (expanded)
		const bottomInspectContainer = rightCard.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } });
		
		const orphanItem = bottomInspectContainer.createDiv({ cls: 'vo-lint-metric-item', attr: { style: 'justify-content: flex-start; align-items: center; cursor: pointer; padding: 8px 10px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const orphanLeft = orphanItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 10px;' } });
		const orphanIconEl = orphanLeft.createDiv(); setIcon(orphanIconEl, 'compass');
		const orphanTextWrap = orphanLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 2px;' } });
		orphanTextWrap.createSpan({ text: '孤儿笔记 (Orphans)', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const orphanDesc = orphanTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		const deadLinkItem = bottomInspectContainer.createDiv({ cls: 'vo-lint-metric-item', attr: { style: 'justify-content: flex-start; align-items: center; cursor: pointer; padding: 8px 10px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const deadLinkLeft = deadLinkItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 10px;' } });
		const deadLinkIconEl = deadLinkLeft.createDiv(); setIcon(deadLinkIconEl, 'link');
		const deadLinkTextWrap = deadLinkLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 2px;' } });
		deadLinkTextWrap.createSpan({ text: '未解析死链 (Dead Links)', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const deadLinkDesc = deadLinkTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		const emptyNoteItem = bottomInspectContainer.createDiv({ cls: 'vo-lint-metric-item', attr: { style: 'justify-content: flex-start; align-items: center; cursor: pointer; padding: 8px 10px; background: var(--background-primary); border-radius: 6px; border: 1px dashed var(--background-modifier-border); transition: border-color 0.2s;' } });
		const emptyNoteLeft = emptyNoteItem.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 10px;' } });
		const emptyNoteIconEl = emptyNoteLeft.createDiv(); setIcon(emptyNoteIconEl, 'file-text');
		const emptyNoteTextWrap = emptyNoteLeft.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 2px;' } });
		emptyNoteTextWrap.createSpan({ text: '空白笔记 (Empty Notes)', attr: { style: 'font-weight: 600; font-size: 12px;' } });
		const emptyNoteDesc = emptyNoteTextWrap.createSpan({ text: '检测中...', attr: { style: 'font-size: 10px; color: var(--text-muted);' } });

		
		inboxItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.inbox.files) new SimpleListModal(this.app, '待分类文件 (Inbox Backlog)', this.currentScanData.inbox.files).open(); });
		diaryItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.uningested.files) new SimpleListModal(this.app, '待入库日记 (Un-ingested Diaries)', this.currentScanData.uningested.files).open(); });
		orphanItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.orphans.files) new SimpleListModal(this.app, '孤儿笔记 (Orphans)', this.currentScanData.orphans.files).open(); });
		deadLinkItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.deadLinks.files) new SimpleListModal(this.app, '未解析死链 (Dead Links)', this.currentScanData.deadLinks.files).open(); });
		emptyNoteItem.addEventListener('click', () => { if (this.currentScanData && this.currentScanData.empty.files) new SimpleListModal(this.app, '空白笔记 (Empty Notes)', this.currentScanData.empty.files).open(); });

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
						statusText.setCssStyles({ color: 'var(--interactive-accent)' });
					} else if (score >= 70) {
						statusText.setText('存在部分需要清理的临时文档或孤立页面。');
						statusText.setCssStyles({ color: 'var(--interactive-accent)' });
					} else {
						statusText.setText('建议尽快运行一键修复清理孤立节点与空白笔记。');
						statusText.setCssStyles({ color: 'var(--interactive-accent)' });
					}

					inboxDesc.setText(`范围: ${this.plugin.settings.inboxFolder} | ${inbox.count} 篇 | 最久 ${inbox.oldestDays} 天`);
					diaryDesc.setText(`范围: ${this.plugin.settings.dailyNoteFolder} | ${uningested.count} 篇未入库`);
					orphanDesc.setText(`范围: ${this.plugin.settings.atomicsFolder} | ${orphans.count} 篇未被知识链路引用`);
					deadLinkDesc.setText(`范围: ${this.plugin.settings.atomicsFolder} | ${deadLinks.count} 处失效链接`);
					emptyNoteDesc.setText(`范围: 全库 Markdown | ${empty.count} 篇正文为空`);
					
					const updateMetricState = (element: HTMLElement, hasItems: boolean) => {
						element.toggleClass('is-attention', hasItems);
					};
					updateMetricState(inboxItem, inbox.count > 0);
					updateMetricState(diaryItem, uningested.count > 0);
					updateMetricState(orphanItem, orphans.count > 0);
					updateMetricState(deadLinkItem, deadLinks.count > 0);
					updateMetricState(emptyNoteItem, empty.count > 0);

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

	private renderSmartCommandsDashboard(parent: Element): void {
		parent.empty();
		parent.addClass('vo-workspace-dashboard', 'vo-commands-workspace');
		const actions = (this.plugin.settings.claudianActions || [])
			.map(action => ({ enabled: true, ...action }))
			.filter(action => action.enabled !== false);
		const categories = normalizeSmartActionCategories(this.plugin.settings.claudianActionCategories);
		const grouped = new Map<string, ClaudianAction[]>();
		for (const action of actions) {
			const categoryId = resolveSmartActionCategoryId(action, categories);
			const group = grouped.get(categoryId) || [];
			group.push(action);
			grouped.set(categoryId, group);
		}

		const intro = parent.createDiv({ cls: 'vo-card vo-tech-card vo-workspace-card vo-commands-intro' });
		const introIcon = intro.createDiv({ cls: 'vo-workspace-card-icon' });
		setIcon(introIcon, 'sparkles');
		const introCopy = intro.createDiv({ cls: 'vo-commands-intro-copy' });
		introCopy.createDiv({ text: '个人智能指令', cls: 'vo-commands-title' });
		introCopy.createDiv({ text: '按你的工作流分类。Vault OS 只提供输入与触发入口，具体处理仍由你配置的 Skill 完成。', cls: 'vo-commands-description' });

		const grid = parent.createDiv({ cls: 'vo-commands-category-grid' });
		let visibleCategoryCount = 0;
		for (const category of categories) {
			const categoryActions = grouped.get(category.id) || [];
			if (categoryActions.length === 0) continue;
			visibleCategoryCount++;
			const card = grid.createDiv({ cls: 'vo-card vo-tech-card vo-workspace-card vo-command-category-card' });
			const header = card.createDiv({ cls: 'vo-command-category-header' });
			const icon = header.createDiv({ cls: 'vo-workspace-card-icon' });
			setIcon(icon, category.icon || 'folder-open');
			const copy = header.createDiv();
			copy.createDiv({ text: category.label, cls: 'vo-command-category-title' });
			if (category.description) copy.createDiv({ text: category.description, cls: 'vo-command-category-description' });
			const actionsGrid = card.createDiv({ cls: 'vo-command-category-actions' });
			for (const action of categoryActions) this.renderSmartCommandAction(actionsGrid, action);
		}

		if (visibleCategoryCount === 0) {
			const empty = grid.createDiv({ cls: 'vo-card vo-tech-card vo-workspace-card vo-commands-empty' });
			empty.createDiv({ text: '还没有启用的智能指令。请在设置中的“智能指令”里新增分类或启用现有指令。' });
		}
	}

	private renderSmartCommandAction(parent: HTMLElement, action: ClaudianAction): void {
		const button = parent.createEl('button', { cls: 'vo-btn vo-btn-secondary vo-workspace-action vo-command-action-button' });
		const icon = button.createSpan({ cls: 'vo-lint-command-icon' });
		setIcon(icon, action.icon || 'sparkles');
		const copy = button.createSpan({ cls: 'vo-command-action-copy' });
		copy.createSpan({ text: action.label, cls: 'vo-command-action-label' });
		if (action.description) copy.createSpan({ text: action.description, cls: 'vo-command-action-description' });
		button.addEventListener('click', () => {
			if (requiresSmartActionInput(action)) {
				new SmartActionInputModal(this.app, action, input => {
					new Notice(`已触发: ${action.label}`);
					this.triggerClaudianPrompt(action.prompt, input);
				}).open();
				return;
			}
			new Notice(`已触发: ${action.label}`);
			this.triggerClaudianPrompt(action.prompt);
		});
	}

	async generateMonthlyReport(): Promise<void> {
		const [inbox, uningested, orphans, deadLinks, empty] = await Promise.all([
			this.vaultService.getInboxBacklog(),
			this.vaultService.getUningestedDiariesCount(),
			this.vaultService.getOrphanCount(),
			this.vaultService.getDeadLinkCount(),
			this.vaultService.getEmptyNotesCount()
		]);
		const generatedAt = new Date();
		const score = this.calculateLintHealthScore({ inbox, orphans, deadLinks, uningested, empty });
		const content = buildMonthlyHealthReport({
			generatedAt,
			score,
			inboxCount: inbox.count,
			inboxOldestDays: inbox.oldestDays,
			uningestedCount: uningested.count,
			orphanCount: orphans.count,
			deadLinkCount: deadLinks.count,
			emptyNoteCount: empty.count,
		});
		const result = await this.healthReports.createReport(
			this.plugin.settings.outputFolder,
			getMonthlyHealthReportFileName(generatedAt),
			content
		);
		if (result.status === 'success' && result.filePath) {
			new Notice(`已生成月度巡检报告: ${result.filePath}`);
			void this.app.workspace.openLinkText(result.filePath, '', false);
		} else {
			new Notice(result.errorMessage || '生成月度巡检报告失败');
		}
	}

	private openLintModal(): void {
		new LintModal(this.app, this.vaultService, this.fileOperations, this).open();
	}

	updateCleanedEmpty(_count: number): void {
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
		void this.vaultService.getOrphanCount().then(result => {
			new SimpleListModal(this.app, '孤儿文件列表 (Orphans)', result.files).open();
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
