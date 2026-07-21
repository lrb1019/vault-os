import { App, Modal, PluginSettingTab, Setting, setIcon } from 'obsidian';
import VaultOsPlugin from './main';
import { createLegacyVaultProfile, isVaultProfile, type ScopeRule, type VaultProfile } from './domain/vault-profile';
import { createDefaultManualPeriodicConfig, type ManualPeriodicConfig, type PeriodicCycle } from './domain/periodic-note';
import { DEFAULT_DAILY_CONTEXT_SETTINGS, type DailyContextSettings } from './domain/daily-context';
import { DEFAULT_SMART_ACTION_CATEGORIES, normalizeSmartActionCategories, resolveSmartActionCategoryId, type SmartAction, type SmartActionCategory } from './domain/smart-action';

export type ClaudianAction = SmartAction;

export interface VaultOsSettings {
	dashboardTitle: string;
	enabledShortcuts: Record<string, boolean>;
	claudianActions: ClaudianAction[];
	claudianActionCategories?: SmartActionCategory[];
	p0EvidenceDebtActionInstalled?: boolean;
	
	dailyNoteFolder: string;
	manualPeriodic?: ManualPeriodicConfig;
	periodicProvider?: 'auto' | 'manual' | 'notebook-navigator';
	inboxFolder: string;
	vaultProfile?: VaultProfile;
	workflowInspectionSnapshot?: import('./domain/workflow-inspection-snapshot').WorkflowInspectionSnapshot;

	archiveFolder: string;
	outputFolder: string;
	atomicsFolder: string;
	thinkingFolder: string;
	synthesisFolder: string;
	
	// Heatmap & Scale settings (new settings)
	heatmapCellSize: number;
	heatmapCellGap: number;
	heatmapDoubleCellSize: number;
	heatmapDoubleCellGap: number;
	containerMaxWidth: number;
	readingReflectionScope?: ScopeRule;
	dailyContext?: DailyContextSettings;
}

type SettingsTabId = 'general' | 'paths' | 'profile' | 'actions';
type EditableProfileScope = 'thinking' | 'synthesis';

export const DEFAULT_SETTINGS: VaultOsSettings = {
	dashboardTitle: "Vault OS",
	enabledShortcuts: {
		"jarvis-reader": true,
		"rss-dashboard": true,
		"notebook-navigator": true,
		"ingest": true,
		"lint": true,
		"query": true,
		"research": true
	},
	claudianActions: [
		{ id: 'action-1', label: '快捷入库 (Ingest)', icon: 'bot', prompt: '@skills/ingest 请帮我整理并分类 {{daily_path}} 中的未入库日记。注意：在生成双向链接时，请只保留文件名，严禁包含前面的文件夹路径（例如，必须是 [[笔记名字]]，绝对不能是 [[{{daily_path}}/笔记名字]] 或 [[{{inbox_path}}/笔记名字]]），否则移动到归档后双链会失效！', requireInput: false, categoryId: 'workflow' },
		{ id: 'action-2', label: '全面体检 (Lint)', icon: 'bot', prompt: '@skills/lint 请帮我扫描并体检整个知识库，找出孤儿笔记与死链并协助修复', requireInput: false, categoryId: 'maintenance' },
		{ id: 'action-3', label: '清理空白 (Clean)', icon: 'bot', prompt: '@skills/lint 请帮我清理库中的所有空白笔记', requireInput: false, categoryId: 'maintenance' },
		{ id: 'action-4', label: '文档审计 (Review)', icon: 'bot', prompt: '@skills/research 请对当前项目与知识库进行全面审计并输出优化意见', requireInput: false, categoryId: 'maintenance' },
		{ id: 'action-5', label: '检索', icon: 'bot', prompt: '@skills/query 请帮我检索关于“{{input}}”的内容', requireInput: true, inputPlaceholder: '输入要查询的知识主题...', categoryId: 'research' },
		{ id: 'action-6', label: '研究', icon: 'bot', prompt: '@skills/research 请针对“{{input}}”这一主题开展深度主题研究', requireInput: true, inputPlaceholder: '输入要研究的主题/方向...', categoryId: 'research' }
	],
	claudianActionCategories: DEFAULT_SMART_ACTION_CATEGORIES.map(category => ({ ...category })),
	dailyNoteFolder: "01 Daily",
	inboxFolder: "02 Inbox",

	archiveFolder: "06 Archive",
	outputFolder: "05 Output",
	atomicsFolder: "04 Atomics",
	thinkingFolder: "04 Thinking",
	synthesisFolder: "05 Synthesis",
	heatmapCellSize: 12,
	heatmapCellGap: 3,
	heatmapDoubleCellSize: 9,
	heatmapDoubleCellGap: 2,
	containerMaxWidth: 100,
	dailyContext: { ...DEFAULT_DAILY_CONTEXT_SETTINGS }
};

class ClaudianActionEditModal extends Modal {
	private readonly originalAction: ClaudianAction;
	private readonly onSaveAction: (action: ClaudianAction) => Promise<void>;
	private readonly onDeleteAction?: () => Promise<void>;
	private readonly categories: readonly SmartActionCategory[];

	constructor(app: App, action: ClaudianAction, categories: readonly SmartActionCategory[], onSaveAction: (action: ClaudianAction) => Promise<void>, onDeleteAction?: () => Promise<void>) {
		super(app);
		this.originalAction = { ...action };
		this.categories = categories;
		this.onSaveAction = onSaveAction;
		this.onDeleteAction = onDeleteAction;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('vo-action-modal');
		contentEl.empty();

		let draft: ClaudianAction = {
			enabled: true,
			...this.originalAction
		};

		contentEl.createEl('h2', { text: '编辑智能指令', cls: 'vo-action-modal-title' });
		const form = contentEl.createDiv({ cls: 'vo-action-modal-form' });

		new Setting(form)
			.setName('按钮名称')
			.setDesc('面板中显示的按钮文字')
			.addText(text => text
				.setPlaceholder('例如：发芽思考')
				.setValue(draft.label)
				.onChange((value) => {
					draft = { ...draft, label: value };
				}));

		new Setting(form)
			.setName('列表描述')
			.setDesc('显示在外层列表里的一句简短说明')
			.addText(text => text
				.setPlaceholder('例如：把碎片灵感发散开，再回库找共鸣')
				.setValue(draft.description || '')
				.onChange((value) => {
					draft = { ...draft, description: value };
				}));

		new Setting(form)
			.setName('所属分类')
			.setDesc('决定它显示在哪个智能指令面板中。')
			.addDropdown(dropdown => {
				for (const category of this.categories) dropdown.addOption(category.id, category.label);
				dropdown.setValue(resolveSmartActionCategoryId(draft, this.categories)).onChange(value => {
					draft = { ...draft, categoryId: value };
				});
			});

		new Setting(form)
			.setName('图标名称')
			.setDesc('填写 Lucide 图标名称，例如 sprout、book-open、rss')
			.addText(text => text
				.setPlaceholder('例如：bot')
				.setValue(draft.icon)
				.onChange((value) => {
					draft = { ...draft, icon: value };
				}));

		new Setting(form)
			.setName('启用独立输入框')
			.setDesc('开启后，点击智能指令卡片会先弹出输入窗口；关闭后，点击会直接发送。')
			.addToggle(toggle => toggle
				.setValue(!!draft.requireInput)
				.onChange((value) => {
						draft = {
							...draft,
							requireInput: value,
							inputPlaceholder: value ? (draft.inputPlaceholder || '') : ''
						};
					}));

		new Setting(form)
			.setName('输入框提示词')
			.setDesc('只在启用独立输入框时生效，会显示在弹出的输入窗口中。')
			.addText(text => text
				.setPlaceholder('例如：输入一个概念或一句灵感')
				.setValue(draft.inputPlaceholder || '')
				.onChange((value) => {
					draft = { ...draft, inputPlaceholder: value };
				}));

		new Setting(form)
			.setName('指令模板')
			.setDesc('点击后发送给 Claudian 的完整内容，可使用 {{input}}、{{daily_path}}、{{inbox_path}}')
			.addTextArea(text => {
				text
					.setPlaceholder('例如：@skills/query 请帮我检索关于“{{input}}”的内容')
					.setValue(draft.prompt)
					.onChange((value) => {
						draft = { ...draft, prompt: value };
					});
				text.inputEl.addClass('vo-action-modal-prompt');
			});

		const footer = contentEl.createDiv({ cls: 'vo-action-modal-footer' });
		const leftActions = footer.createDiv({ cls: 'vo-action-modal-footer-left' });
		const rightActions = footer.createDiv({ cls: 'vo-action-modal-footer-right' });
		if (this.onDeleteAction) {
			const deleteBtn = leftActions.createEl('button', { text: '删除', cls: 'mod-warning' });
			deleteBtn.addEventListener('click', () => {
				void this.onDeleteAction?.().then(() => this.close());
			});
		}
		const cancelBtn = rightActions.createEl('button', { text: '取消' });
		const saveBtn = rightActions.createEl('button', { text: '保存', cls: 'mod-cta' });

		cancelBtn.addEventListener('click', () => this.close());
		saveBtn.addEventListener('click', () => {
			void this.onSaveAction({
				...draft,
				enabled: draft.enabled !== false,
				label: draft.label.trim() || '新指令',
				description: (draft.description || '').trim(),
				icon: draft.icon.trim(),
				prompt: draft.prompt.trim(),
				inputPlaceholder: draft.requireInput ? (draft.inputPlaceholder || '').trim() : ''
			}).then(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class SmartActionCategoryEditModal extends Modal {
	private readonly category: SmartActionCategory;
	private readonly onSaveCategory: (category: SmartActionCategory) => Promise<void>;

	constructor(app: App, category: SmartActionCategory, onSaveCategory: (category: SmartActionCategory) => Promise<void>) {
		super(app);
		this.category = { ...category };
		this.onSaveCategory = onSaveCategory;
	}

	onOpen(): void {
		this.contentEl.empty();
		let draft = { ...this.category };
		this.contentEl.createEl('h2', { text: '编辑智能指令分类' });
		new Setting(this.contentEl).setName('分类名称').addText(text => text.setValue(draft.label).onChange(value => { draft = { ...draft, label: value }; }));
		new Setting(this.contentEl).setName('分类说明').addText(text => text.setValue(draft.description || '').onChange(value => { draft = { ...draft, description: value }; }));
		new Setting(this.contentEl).setName('图标名称').addText(text => text.setValue(draft.icon).onChange(value => { draft = { ...draft, icon: value }; }));
		const footer = this.contentEl.createDiv({ cls: 'vo-action-modal-footer' });
		const cancel = footer.createEl('button', { text: '取消' });
		const save = footer.createEl('button', { text: '保存', cls: 'mod-cta' });
		cancel.addEventListener('click', () => this.close());
		save.addEventListener('click', () => {
			void this.onSaveCategory({ ...draft, label: draft.label.trim() || '新分类', description: (draft.description || '').trim(), icon: draft.icon.trim() || 'folder-open' }).then(() => this.close());
		});
	}
}

export class VaultOsSettingTab extends PluginSettingTab {
	plugin: VaultOsPlugin;
	private activeTab: SettingsTabId = 'general';

	constructor(app: App, plugin: VaultOsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private normalizeFolderPath(value: string): string {
		return value.trim().replace(/^\/+|\/+$/g, '');
	}

	private getEditableVaultProfile(): VaultProfile {
		if (isVaultProfile(this.plugin.settings.vaultProfile)) return this.plugin.settings.vaultProfile;
		return createLegacyVaultProfile({
			dailyNoteFolder: this.plugin.settings.dailyNoteFolder,
			inboxFolder: this.plugin.settings.inboxFolder,
			atomicsFolder: this.plugin.settings.atomicsFolder,
			outputFolder: this.plugin.settings.outputFolder,
			thinkingFolder: this.plugin.settings.thinkingFolder,
			synthesisFolder: this.plugin.settings.synthesisFolder
		});
	}

	private getManualPeriodicConfig(): ManualPeriodicConfig {
		return this.plugin.settings.manualPeriodic || createDefaultManualPeriodicConfig(this.plugin.settings.dailyNoteFolder);
	}

	private async saveManualPeriodicConfig(config: ManualPeriodicConfig): Promise<void> {
		this.plugin.settings.manualPeriodic = config;
		await this.plugin.saveSettings();
		this.refreshDashboardView();
	}

	private async saveProfileRule(scope: EditableProfileScope, rule: ScopeRule, rerenderSettings = false): Promise<void> {
		const profile = this.getEditableVaultProfile();
		this.plugin.settings.vaultProfile = { ...profile, [scope]: rule };
		await this.plugin.saveSettings();
		if (rerenderSettings) this.display();
	}

	private async saveVaultProfile(profile: VaultProfile, rerenderSettings = false): Promise<void> {
		this.plugin.settings.vaultProfile = profile;
		await this.plugin.saveSettings();
		if (rerenderSettings) this.display();
	}

	private createCollapsibleSection(container: HTMLElement, title: string, description: string, open = false): HTMLElement {
		const details = container.createEl('details', { cls: 'vo-settings-collapsible-section' });
		if (open) details.setAttr('open', '');
		const summary = details.createEl('summary');
		summary.createSpan({ text: title, cls: 'vo-settings-collapsible-title' });
		summary.createSpan({ text: description, cls: 'vo-settings-collapsible-description' });
		return details.createDiv({ cls: 'vo-settings-collapsible-content' });
	}

	private getActionCategories(): SmartActionCategory[] {
		return normalizeSmartActionCategories(this.plugin.settings.claudianActionCategories);
	}

	private async saveActionCategories(categories: SmartActionCategory[]): Promise<void> {
		this.plugin.settings.claudianActionCategories = normalizeSmartActionCategories(categories);
		await this.plugin.saveSettings();
		this.display();
		this.refreshDashboardView();
	}

	private async applyThinkingMapPreset(): Promise<void> {
		const profile = this.getEditableVaultProfile();
		const recommendedExclusions = ['00 Attachment', '00 Flomo', '00 Templates', '06 Archive', '07 Jarvis', '08 Data', '09 Books'];
		const existingFolderPaths = profile.exclusions
			.filter((rule): rule is Extract<ScopeRule, { type: 'folder' }> => rule.type === 'folder')
			.flatMap(rule => rule.paths);
		const exclusionPaths = [...new Set([...existingFolderPaths, ...recommendedExclusions])];
		const nonFolderExclusions = profile.exclusions.filter(rule => rule.type !== 'folder');
		await this.saveVaultProfile({
			...profile,
			label: 'BYLRB 个人心智仓库',
			thinking: { type: 'folder', paths: [this.plugin.settings.thinkingFolder], recursive: true },
			synthesis: { type: 'folder', paths: [this.plugin.settings.synthesisFolder], recursive: true },
			exclusions: [...nonFolderExclusions, { type: 'folder', paths: exclusionPaths, recursive: true }]
		}, true);
	}

	private parseCommaSeparated(value: string): string[] {
		return value.split(',').map(item => item.trim()).filter(Boolean);
	}

	private async saveReadingReflectionScope(rule: ScopeRule, rerenderSettings = false): Promise<void> {
		this.plugin.settings.readingReflectionScope = rule;
		await this.plugin.saveSettings();
		this.refreshDashboardView();
		if (rerenderSettings) this.display();
	}

	private getDailyContextSettings(): DailyContextSettings {
		return { ...DEFAULT_DAILY_CONTEXT_SETTINGS, ...this.plugin.settings.dailyContext };
	}

	private async saveDailyContextSettings(next: DailyContextSettings): Promise<void> {
		this.plugin.settings.dailyContext = next;
		await this.plugin.saveSettings();
		this.refreshDashboardView();
	}

	private renderScopeRuleEditor(
		container: HTMLElement,
		name: string,
		description: string,
		rule: ScopeRule | undefined,
		onSave: (rule: ScopeRule, rerenderSettings?: boolean) => Promise<void>
	): void {
		if (!rule || rule.type === 'compound') {
			this.createNote(
				container,
				`${name}当前使用未配置或组合规则。组合规则会被保留；如切换下方识别方式，将以新的基础规则替换它。`,
				'vo-settings-note-subtle'
			);
		}

		const editableRule = rule && rule.type !== 'compound' ? rule : { type: 'folder', paths: [], recursive: true } satisfies ScopeRule;
		const ruleType = editableRule.type;
		new Setting(container)
			.setName(`${name}识别方式`)
			.setDesc(description)
			.addDropdown(dropdown => dropdown
				.addOption('folder', '文件夹')
				.addOption('tag', '标签')
				.addOption('property', '属性')
				.addOption('all-markdown', '整个仓库')
				.setValue(ruleType)
				.onChange(async value => {
					if (value === 'tag') await onSave({ type: 'tag', tags: [] }, true);
					else if (value === 'property') await onSave({ type: 'property', key: '', values: [] }, true);
					else if (value === 'all-markdown') await onSave({ type: 'all-markdown' }, true);
					else await onSave({ type: 'folder', paths: [], recursive: true }, true);
				}));

		if (editableRule.type === 'folder') {
			new Setting(container)
				.setName(`${name}文件夹`)
				.setDesc('使用逗号分隔多个路径，例如 Inbox, Capture。')
				.addText(text => text
					.setPlaceholder('例如：Inbox, Capture')
					.setValue(editableRule.paths.join(', '))
					.onChange(async value => {
						const paths = value.split(',').map(path => this.normalizeFolderPath(path)).filter(Boolean);
						await onSave({ type: 'folder', paths, recursive: editableRule.recursive !== false });
					}));
			new Setting(container)
				.setName('包含子文件夹')
				.setDesc('关闭后，只匹配该目录的直接 Markdown 文件。')
				.addToggle(toggle => toggle
					.setValue(editableRule.recursive !== false)
					.onChange(async value => {
						await onSave({ type: 'folder', paths: editableRule.paths, recursive: value });
					}));
		} else if (editableRule.type === 'tag') {
			new Setting(container)
				.setName(`${name}标签`)
				.setDesc('使用逗号分隔多个标签，任一标签匹配即可。')
				.addText(text => text
					.setPlaceholder('inbox, capture')
					.setValue(editableRule.tags.join(', '))
					.onChange(async value => {
						const tags = value.split(',').map(tag => tag.trim()).filter(Boolean);
						await onSave({ type: 'tag', tags });
					}));
		} else if (editableRule.type === 'property') {
			new Setting(container)
				.setName('属性名称')
				.setDesc('例如 status、type 或 workflow。')
				.addText(text => text
					.setPlaceholder('status')
					.setValue(editableRule.key)
					.onChange(async value => {
						await onSave({ type: 'property', key: value.trim(), values: editableRule.values });
					}));
			new Setting(container)
				.setName('属性值')
				.setDesc('使用逗号分隔多个匹配值。')
				.addText(text => text
					.setPlaceholder('inbox, captured')
					.setValue(editableRule.values.join(', '))
					.onChange(async value => {
						const values = value.split(',').map(item => item.trim()).filter(Boolean);
						await onSave({ type: 'property', key: editableRule.key, values });
					}));
		}
	}

	private renderVaultProfileSettings(container: HTMLElement): void {
		const isConfigured = isVaultProfile(this.plugin.settings.vaultProfile);
		const profile = this.getEditableVaultProfile();

		this.createNote(
			container,
			'思想脉络用于观察个人思想从形成、沉淀到阶段综合的状态与连接，帮助你看清正在发展的理解和已经形成的认识。'
		);

		if (!isConfigured) {
			new Setting(container)
				.setName('启用思想脉络')
				.setDesc('保存当前目录角色并启用只读观察。不会创建、修改或移动任何笔记。')
				.addButton(button => button
					.setButtonText('启用')
					.setCta()
					.onClick(async () => {
						this.plugin.settings.vaultProfile = profile;
						await this.plugin.saveSettings();
						this.display();
					}));
			return;
		}

		const quickStart = container.createDiv({ cls: 'vo-settings-quickstart' });
		quickStart.createDiv({ text: '当前服务对象', cls: 'vo-settings-quickstart-title' });
		quickStart.createEl('p', {
			text: 'BYLRB 个人心智仓库：生活由周期复盘回看，思想由这里观察，两者不重复。',
			cls: 'setting-item-description'
		});
		new Setting(quickStart)
			.setName('应用 README 推荐口径')
			.setDesc(`个人思想：${this.plugin.settings.thinkingFolder}；阶段综合：${this.plugin.settings.synthesisFolder}。`)
			.addButton(button => button
				.setButtonText('应用')
				.setCta()
				.onClick(() => {
					void this.applyThinkingMapPreset();
				}));

		const safeFolderCount = profile.exclusions.filter(rule => rule.type === 'folder').flatMap(rule => rule.paths).length;
		new Setting(quickStart)
			.setName('只读与隐私边界')
			.setDesc(safeFolderCount > 0
				? `只读观察；读取前跳过 ${safeFolderCount} 个受保护目录。`
				: '尚未配置安全排除，思想脉络将安全停止，不会扩大扫描范围。');

		this.createSectionHeading(container, '识别口径');
		new Setting(container)
			.setName('正在形成')
			.setDesc('Thinking 中 stage 为 developing，或尚未设置 stage 的笔记。未分类内容只提示，不会被自动修改。');
		new Setting(container)
			.setName('已形成理解')
			.setDesc('Thinking 中 stage 为 settled 的笔记。settled 只代表当前阶段愿意承担，未来仍可修正。');
		new Setting(container)
			.setName('阶段综合')
			.setDesc('Synthesis 范围内的笔记，并显示其连接了多少条 Thinking。它不等于公开 Output。');

		const advanced = this.createCollapsibleSection(container, '安全与自定义范围', '通常应用推荐口径后无需再改。');

		new Setting(advanced)
			.setName('永不读取的文件夹')
			.setDesc('逗号分隔。匹配目录会在读取属性、链接或正文之前被排除；留空时思想脉络将安全停止。')
			.addText(text => text
				.setPlaceholder('例如：08 Data, Private')
				.setValue(profile.exclusions.filter(rule => rule.type === 'folder').flatMap(rule => rule.paths).join(', '))
				.onChange(async value => {
					const currentProfile = this.getEditableVaultProfile();
					const folderRule: ScopeRule = { type: 'folder', paths: this.parseCommaSeparated(value).map(path => this.normalizeFolderPath(path)), recursive: true };
					const nonFolderRules = currentProfile.exclusions.filter(rule => rule.type !== 'folder');
					await this.saveVaultProfile({ ...currentProfile, exclusions: folderRule.paths.length > 0 ? [...nonFolderRules, folderRule] : nonFolderRules });
				}));

		this.renderScopeRuleEditor(
			advanced,
			'个人思想范围',
			'只用于展示正在形成、已经形成和需要继续回应的个人思想。',
			profile.thinking,
			(rule, rerenderSettings) => this.saveProfileRule('thinking', rule, rerenderSettings)
		);
		this.renderScopeRuleEditor(
			advanced,
			'阶段综合范围',
			'只用于展示由多条思想、长期日记和真实经历形成的阶段理解。',
			profile.synthesis,
			(rule, rerenderSettings) => this.saveProfileRule('synthesis', rule, rerenderSettings)
		);
	}

	private createNote(container: HTMLElement, text: string, extraClass?: string): void {
		container.createEl('p', {
			text,
			cls: `vo-settings-note${extraClass ? ` ${extraClass}` : ''}`
		});
	}

	private createLucideNote(container: HTMLElement): void {
		const note = container.createEl('p', { cls: 'vo-settings-note vo-settings-note-subtle' });
		note.appendText('图标名称来自 ');
		note.createEl('a', {
			text: 'Lucide Icons',
			href: 'https://lucide.dev/icons/',
			cls: 'vo-settings-note-link',
			attr: { target: '_blank', rel: 'noopener noreferrer' }
		});
		note.appendText('。把站点上的图标名填进图标字段即可。');
	}

	private runAsyncTask(task: () => Promise<void>): void {
		void task().catch(error => {
			console.error('Vault OS settings action failed:', error);
		});
	}

	private createActionTemplate(): ClaudianAction {
		return {
			id: `action-${Date.now()}`,
			label: '新指令',
			description: '',
			icon: 'bot',
			prompt: '',
			requireInput: false,
			enabled: true,
			inputPlaceholder: '',
			categoryId: 'unclassified'
		};
	}

	private async addAction(): Promise<void> {
		this.plugin.settings.claudianActions.push(this.createActionTemplate());
		await this.plugin.saveSettings();
		this.display();
		this.refreshDashboardView();
	}

	private createSectionHeading(container: HTMLElement, title: string): void {
		const heading = new Setting(container).setName(title).setHeading();
		heading.settingEl.addClass('vo-settings-section-heading');
		heading.nameEl.addClass('vo-actions-toolbar-title');
	}

	private createActionToolbar(container: HTMLElement, title: string): void {
		const header = container.createDiv({ cls: 'vo-actions-toolbar' });
		this.createSectionHeading(header, title);

		const addBtn = header.createEl('button', { text: '+', cls: 'vo-actions-toolbar-add' });
		addBtn.addEventListener('click', () => {
			this.runAsyncTask(async () => {
				await this.addAction();
			});
		});
	}

	private normalizeAction(action: ClaudianAction): ClaudianAction {
		const normalizedAction = { ...action } as ClaudianAction & { showOnHome?: boolean };
		delete normalizedAction.showOnHome;
		return {
			enabled: true,
			description: '',
			inputPlaceholder: '',
			...normalizedAction,
			categoryId: resolveSmartActionCategoryId(normalizedAction, this.getActionCategories())
		};
	}

	private renderActionCategories(sectionContent: HTMLElement): void {
		this.createSectionHeading(sectionContent, '分类面板');
		this.createNote(sectionContent, '分类决定“智能指令”主界面的分组。编辑分类只改变展示；删除分类会把其中指令移到“未分类”。', 'vo-settings-note-subtle');
		const list = sectionContent.createDiv({ cls: 'vo-actions-compact-list vo-action-category-list' });
		for (const category of this.getActionCategories()) {
			const row = list.createDiv({ cls: 'vo-actions-compact-row vo-action-category-row' });
			const main = row.createDiv({ cls: 'vo-actions-compact-main' });
			const iconWrap = main.createDiv({ cls: 'vo-actions-compact-icon' });
			setIcon(iconWrap, category.icon || 'folder-open');
			const text = main.createDiv({ cls: 'vo-actions-compact-text' });
			text.createDiv({ text: category.label, cls: 'vo-actions-compact-title' });
			text.createDiv({ text: category.description || '未填写分类说明', cls: 'vo-actions-compact-desc' });
			const controls = row.createDiv({ cls: 'vo-actions-compact-controls' });
			const edit = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '编辑分类' } });
			setIcon(edit, 'pencil');
			edit.addEventListener('click', () => {
				new SmartActionCategoryEditModal(this.app, category, async next => {
					await this.saveActionCategories(this.getActionCategories().map(item => item.id === category.id ? next : item));
				}).open();
			});
			if (category.id !== 'unclassified') {
				const remove = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '删除分类' } });
				setIcon(remove, 'trash-2');
				remove.addEventListener('click', () => {
					this.runAsyncTask(async () => {
						this.plugin.settings.claudianActions = this.plugin.settings.claudianActions.map(action => action.categoryId === category.id ? { ...action, categoryId: 'unclassified' } : action);
						await this.saveActionCategories(this.getActionCategories().filter(item => item.id !== category.id));
					});
				});
			}
		}
		const add = sectionContent.createEl('button', { text: '+ 新增分类', cls: 'vo-btn vo-btn-secondary vo-action-category-add' });
		add.addEventListener('click', () => {
			const category: SmartActionCategory = { id: `category-${Date.now()}`, label: '新分类', description: '', icon: 'folder-open' };
			new SmartActionCategoryEditModal(this.app, category, async next => {
				await this.saveActionCategories([...this.getActionCategories(), next]);
			}).open();
		});
	}

	private getActionSummary(action: ClaudianAction): string {
		const prompt = action.prompt.replace(/\s+/g, ' ').trim();
		if (!prompt) return '尚未配置指令模板';
		return prompt.length > 72 ? `${prompt.slice(0, 72)}...` : prompt;
	}

	private async saveAction(index: number, nextAction: ClaudianAction): Promise<void> {
		this.plugin.settings.claudianActions[index] = this.normalizeAction(nextAction);
		await this.plugin.saveSettings();
		this.display();
		this.refreshDashboardView();
	}

	private async deleteAction(index: number): Promise<void> {
		this.plugin.settings.claudianActions.splice(index, 1);
		await this.plugin.saveSettings();
		this.display();
		this.refreshDashboardView();
	}

	private renderActionList(sectionContent: HTMLElement): void {
		const actions = (this.plugin.settings.claudianActions || []).map(action => this.normalizeAction(action));
		this.plugin.settings.claudianActions = actions;

		this.createActionToolbar(sectionContent, '指令列表');

		const list = sectionContent.createDiv({ cls: 'vo-actions-list' });

		actions.forEach((action, index) => {
			const row = list.createDiv({ cls: 'vo-actions-list-row' });
			const main = row.createDiv({ cls: 'vo-actions-list-main' });
			const iconWrap = main.createDiv({ cls: 'vo-actions-list-icon' });
			setIcon(iconWrap, action.icon || 'bot');

			const textWrap = main.createDiv({ cls: 'vo-actions-list-text' });
			textWrap.createDiv({ text: action.label || `指令 ${index + 1}`, cls: 'vo-actions-list-title' });
			textWrap.createDiv({
				text: `${action.requireInput ? '带输入框' : '纯按钮'} · ${this.getActionSummary(action)}`,
				cls: 'vo-actions-list-desc'
			});

			const controls = row.createDiv({ cls: 'vo-actions-list-controls' });
			const statusWrap = controls.createDiv({ cls: 'vo-actions-list-status' });
			statusWrap.createSpan({ text: action.enabled !== false ? '启用' : '关闭' });
			new Setting(statusWrap)
				.addToggle(toggle => toggle
					.setValue(action.enabled !== false)
					.onChange((value) => {
						this.runAsyncTask(async () => {
							await this.saveAction(index, { ...action, enabled: value });
						});
					}));

			const editBtn = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '编辑指令' } });
			setIcon(editBtn, 'pencil');
			editBtn.addEventListener('click', () => {
				new ClaudianActionEditModal(this.app, action, this.getActionCategories(), async (nextAction) => {
					await this.saveAction(index, nextAction);
				}).open();
			});

			const deleteBtn = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '删除指令' } });
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.addEventListener('click', () => {
				this.runAsyncTask(async () => {
					await this.deleteAction(index);
				});
			});
		});
	}

	private renderActionListCompact(sectionContent: HTMLElement): void {
		const actions = (this.plugin.settings.claudianActions || []).map(action => this.normalizeAction(action));
		this.plugin.settings.claudianActions = actions;

		this.createActionToolbar(sectionContent, '指令列表');

		const list = sectionContent.createDiv({ cls: 'vo-actions-compact-list' });
		actions.forEach((action, index) => {
			const row = list.createDiv({ cls: 'vo-actions-compact-row' });

			const left = row.createDiv({ cls: 'vo-actions-compact-main' });
			const iconWrap = left.createDiv({ cls: 'vo-actions-compact-icon' });
			setIcon(iconWrap, action.icon || 'bot');

			const textWrap = left.createDiv({ cls: 'vo-actions-compact-text' });
			textWrap.createDiv({ text: action.label || `指令 ${index + 1}`, cls: 'vo-actions-compact-title' });
			textWrap.createDiv({
				text: (action.description || '').trim() || (action.requireInput ? '需要输入，在智能指令页执行' : '智能指令页直接执行'),
				cls: 'vo-actions-compact-desc'
			});

			const right = row.createDiv({ cls: 'vo-actions-compact-controls' });
			const editBtn = right.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '编辑指令' } });
			setIcon(editBtn, 'pencil');
			editBtn.addEventListener('click', () => {
				new ClaudianActionEditModal(
					this.app,
					action,
					this.getActionCategories(),
					async (nextAction) => {
						await this.saveAction(index, nextAction);
					},
					async () => {
						await this.deleteAction(index);
					}
				).open();
			});

			const deleteBtn = right.createEl('button', {
				cls: 'clickable-icon',
				attr: { 'aria-label': '删除指令' }
			});
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.addEventListener('click', () => {
				this.runAsyncTask(async () => {
					await this.deleteAction(index);
				});
			});

			const toggleBtn = right.createEl('button', {
				cls: 'clickable-icon',
				attr: { 'aria-label': action.enabled !== false ? '关闭指令' : '启用指令' }
			});
			setIcon(toggleBtn, action.enabled !== false ? 'toggle-right' : 'toggle-left');
			toggleBtn.addEventListener('click', () => {
				this.runAsyncTask(async () => {
					await this.saveAction(index, { ...action, enabled: !(action.enabled !== false) });
				});
			});
		});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Horizontal tabs menu
		const tabsContainer = containerEl.createDiv({ cls: 'vo-settings-tabs-container' });

		const createTabBtn = (id: SettingsTabId, label: string, icon: string) => {
			const btn = tabsContainer.createDiv({
				cls: `vo-settings-tab-btn ${this.activeTab === id ? 'is-active' : ''}`
			});
			const iconSpan = btn.createSpan({ cls: 'vo-settings-tab-icon' });
			setIcon(iconSpan, icon);
			btn.createSpan({ text: ` ${label}` });
			btn.addEventListener('click', () => {
				this.activeTab = id;
				this.display();
			});
		};

		createTabBtn('general', '基础设置', 'layout');
		createTabBtn('paths', '目录与周期', 'folder');
		createTabBtn('profile', '思想脉络', 'brain-circuit');
		createTabBtn('actions', '智能指令', 'bot');

		// Render active tab content
		const sectionContent = containerEl.createDiv({ cls: 'vo-settings-section-content' });

		if (this.activeTab === 'general') {
			this.createNote(
				sectionContent,
				'这里只保留真正影响看板显示和数据口径的设置。热力图尺寸这类低频技术参数已固定为默认值，不再放进界面里继续增加噪音。'
			);

			new Setting(sectionContent)
				.setName('看板主标题')
				.setDesc('自定义 dashboard 看板顶部显示的主标题')
				.addText(text => text
					.setPlaceholder('输入看板标题')
					.setValue(this.plugin.settings.dashboardTitle)
					.onChange(async (value) => {
						this.plugin.settings.dashboardTitle = value;
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('界面最大宽度 (%)')
				.setDesc('控制面板在屏幕上的最大横向占比。100% 为全屏撑满，调小可防止超大屏幕下严重拉伸。')
				.addSlider(slider => slider
					.setLimits(50, 100, 1)
					.setValue(this.plugin.settings.containerMaxWidth || 100)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.containerMaxWidth = value;
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			this.createSectionHeading(sectionContent, '每日阅读回看');
			this.createNote(
				sectionContent,
				'首页会从此范围的 Markdown 块引用中读取带“想法、笔记或感想”的内容，每天稳定随机展示一条。读取只发生在本地，不依赖 Jarvis Reader 的私有数据。'
			);
			this.renderScopeRuleEditor(
				sectionContent,
				'阅读回看范围',
				'建议选择你的读书笔记文件夹；也可按标签或属性筛选。未配置时首页不会扫描整个仓库。',
				this.plugin.settings.readingReflectionScope,
				(rule, rerenderSettings) => this.saveReadingReflectionScope(rule, rerenderSettings)
			);

			const dailyContext = this.getDailyContextSettings();
			this.createSectionHeading(sectionContent, '天气与外部每日一句');
			this.createNote(
				sectionContent,
				'两项默认关闭。开启天气后会将城市名称发送给 Open-Meteo；开启每日一句后会请求一言或 ZenQuotes。每项每天最多更新一次，离线时保留最近缓存。'
			);
			new Setting(sectionContent)
				.setName('显示天气')
				.setDesc('仅使用你填写的城市名，不请求设备定位。')
				.addToggle(toggle => toggle.setValue(dailyContext.weatherEnabled).onChange(async value => {
					await this.saveDailyContextSettings({ ...this.getDailyContextSettings(), weatherEnabled: value });
				}));
			new Setting(sectionContent)
				.setName('天气城市')
				.setDesc('例如：北京、上海、London。仅在开启天气后用于查询。')
				.addText(text => text.setPlaceholder('输入城市').setValue(dailyContext.weatherCity).onChange(async value => {
					await this.saveDailyContextSettings({ ...this.getDailyContextSettings(), weatherCity: value.trim(), cache: undefined });
				}));
			new Setting(sectionContent)
				.setName('显示外部每日一句')
				.setDesc('与个人阅读回看并列为小型补充，保留原始来源与作者。')
				.addToggle(toggle => toggle.setValue(dailyContext.quoteEnabled).onChange(async value => {
					await this.saveDailyContextSettings({ ...this.getDailyContextSettings(), quoteEnabled: value });
				}));
			new Setting(sectionContent)
				.setName('每日一句语言')
				.setDesc('中文来自一言，英文来自 ZenQuotes；中英随机按日期稳定选择。')
				.addDropdown(dropdown => dropdown
					.addOption('zh', '中文')
					.addOption('en', '英文')
					.addOption('mixed', '中英随机')
					.setValue(dailyContext.quoteLanguage)
					.onChange(async value => {
						const quoteLanguage = value === 'en' || value === 'mixed' ? value : 'zh';
						await this.saveDailyContextSettings({ ...this.getDailyContextSettings(), quoteLanguage, cache: undefined });
					}));

			return;

		} else if (this.activeTab === 'paths') {
			const manualPeriodic = this.getManualPeriodicConfig();
			const periodicNames: Record<PeriodicCycle, string> = {
				day: '日记', week: '周记', month: '月记', quarter: '季记', year: '年记'
			};
			this.createNote(
				sectionContent,
					'目录角色遵循 BYLRB README：Daily 服务记录与周期复盘，Thinking 保存个人思想，Synthesis 保存阶段综合。Archive 只作冷存储，不参与思想脉络。'
			);

			new Setting(sectionContent)
				.setName('日记文件夹路径')
				.setDesc('该文件夹中的内容都会被视为日记来源。日记统计、首篇日记判断与周期创建都以这里为准。')
				.addText(text => text
					.setPlaceholder('例如: 01 Daily')
					.setValue(this.plugin.settings.dailyNoteFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteFolder = this.normalizeFolderPath(value);
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			const periodicDetails = this.createCollapsibleSection(
				sectionContent,
				'周期笔记详细规则',
				'日、周、月、季、年文件模式和模板；现有规则正常时无需展开。'
			);

			new Setting(periodicDetails)
				.setName('周期笔记 Provider')
				.setDesc('自动模式兼容已安装的 Notebook Navigator；选择内置手动规则后，周期创建完全使用本插件的配置。')
				.addDropdown(dropdown => dropdown
					.addOption('auto', '自动（兼容第三方）')
					.addOption('manual', '内置手动规则')
					.addOption('notebook-navigator', 'Notebook Navigator 优先')
					.setValue(this.plugin.settings.periodicProvider || 'auto')
					.onChange(async value => {
						this.plugin.settings.periodicProvider = value === 'manual' || value === 'notebook-navigator' ? value : 'auto';
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(periodicDetails)
				.setName('内置周期笔记根目录')
				.setDesc('仅在选择“内置手动规则”或第三方不可用时使用。首次修改会保存独立配置，不再跟随旧日记路径。')
				.addText(text => text
					.setPlaceholder('例如：Journal')
					.setValue(manualPeriodic.rootFolder)
					.onChange(async value => {
						const config = this.getManualPeriodicConfig();
						await this.saveManualPeriodicConfig({ ...config, rootFolder: this.normalizeFolderPath(value) });
					}));

			for (const cycle of ['day', 'week', 'month', 'quarter', 'year'] as const) {
				new Setting(periodicDetails)
					.setName(`${periodicNames[cycle]}文件模式`)
					.setDesc('可包含子目录，例如 YYYY/MM/YYYY-MM-DD；使用 Moment 格式。')
					.addText(text => text
						.setValue(manualPeriodic.patterns[cycle])
						.onChange(async value => {
							const config = this.getManualPeriodicConfig();
							await this.saveManualPeriodicConfig({
								...config,
								patterns: { ...config.patterns, [cycle]: value.trim() || config.patterns[cycle] }
							});
						}));
				new Setting(periodicDetails)
					.setName(`${periodicNames[cycle]}模板路径`)
					.setDesc('可选。未配置或文件不可用时，将创建带基础元数据的默认笔记。')
					.addText(text => text
						.setPlaceholder('例如：Templates/Daily.md')
						.setValue(manualPeriodic.templates[cycle])
						.onChange(async value => {
							const config = this.getManualPeriodicConfig();
							await this.saveManualPeriodicConfig({
								...config,
								templates: { ...config.templates, [cycle]: this.normalizeFolderPath(value) }
							});
						}));
			}

			new Setting(sectionContent)
				.setName('收件箱文件夹路径')
				.setDesc('作为少量外部材料的临时入口，并提供给智能指令中的 {{inbox_path}}。不要求清零。')
				.addText(text => text
					.setPlaceholder('例如: 02 Inbox')
					.setValue(this.plugin.settings.inboxFolder)
					.onChange(async (value) => {
						this.plugin.settings.inboxFolder = this.normalizeFolderPath(value);
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('Thinking 文件夹路径')
				.setDesc('思想脉络中“正在形成”和“已形成理解”的来源。')
				.addText(text => text
					.setPlaceholder('例如: 04 Thinking')
					.setValue(this.plugin.settings.thinkingFolder)
					.onChange(async value => {
						this.plugin.settings.thinkingFolder = this.normalizeFolderPath(value);
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('Synthesis 文件夹路径')
				.setDesc('思想脉络中“阶段综合”的来源。')
				.addText(text => text
					.setPlaceholder('例如: 05 Synthesis')
					.setValue(this.plugin.settings.synthesisFolder)
					.onChange(async value => {
						this.plugin.settings.synthesisFolder = this.normalizeFolderPath(value);
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('Archive 文件夹路径')
				.setDesc('原始材料、历史资料和旧系统的冷存储位置；思想脉络不会将其当作待处理队列。')
				.addText(text => text
					.setPlaceholder('例如: 06 Archive')
					.setValue(this.plugin.settings.archiveFolder)
					.onChange(async (value) => {
						this.plugin.settings.archiveFolder = this.normalizeFolderPath(value);
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			this.createNote(
				sectionContent,
				'思想脉络只检查 Thinking 与 Synthesis 范围内的明确死链和真正空白文件，不扫描 Daily、Inbox 或 Archive 来制造维护压力。',
				'vo-settings-note-subtle'
			);

			} else if (this.activeTab === 'profile') {
				this.renderVaultProfileSettings(sectionContent);
				return;


		} else if (this.activeTab === 'actions') {
			this.createNote(
				sectionContent,
				'这里配置的是“智能指令”主界面的自定义面板与 Skill。它们不会自己执行内容，而是把你写好的指令模板转交给 Claudian（realclaudian）插件。'
			);
			this.createNote(
				sectionContent,
				'需要用户临时输入内容时，请在模板里使用 {{input}}。如果你改了上面的日记 / Inbox / 项目等路径，这里的 {{daily_path}}、{{inbox_path}} 也会自动跟着替换。',
				'vo-settings-note-subtle'
			);
			this.createLucideNote(sectionContent);
			this.renderActionCategories(sectionContent);
			this.renderActionListCompact(sectionContent);
			return;

			this.plugin.settings.claudianActions.forEach((action, index) => {
				const settingWrap = sectionContent.createDiv({ cls: 'vo-setting-action-item' });
				
				// Label & Icon
				new Setting(settingWrap)
					.setName(`指令 ${index + 1}`)
					.addText(text => text
						.setPlaceholder('按钮显示文本')
						.setValue(action.label)
						.onChange(async (val) => {
							action.label = val;
							await this.plugin.saveSettings();
							this.refreshDashboardView();
						}))
					.addText(text => text
						.setPlaceholder('Lucide 图标名称 (例如 bot)')
						.setValue(action.icon)
						.onChange(async (val) => {
							action.icon = val;
							await this.plugin.saveSettings();
							this.refreshDashboardView();
						}));

				// Prompt
				new Setting(settingWrap)
					.setName('指令模板')
					.setDesc('点击后发送的指令内容。可以使用 {{input}} 接收输入。可以使用 {{daily_path}} 等引用路径变量。')
					.addTextArea(text => text
						.setPlaceholder('例如: @skills/query {{input}}')
						.setValue(action.prompt)
						.onChange(async (val) => {
							action.prompt = val;
							await this.plugin.saveSettings();
						}));

				// Require Input
				new Setting(settingWrap)
					.setName('开启独立输入框')
					.setDesc('如果开启，按钮左侧会提供一个输入框，用于临时填写本次执行参数。')
					.addToggle(toggle => toggle
						.setValue(action.requireInput)
						.onChange(async (val) => {
							action.requireInput = val;
							await this.plugin.saveSettings();
							this.display(); // re-render to show/hide placeholder input
							this.refreshDashboardView();
						}));

				if (action.requireInput) {
					new Setting(settingWrap)
						.setName('输入框提示词 (Placeholder)')
						.addText(text => text
							.setPlaceholder('例如: 输入要检索的主题...')
							.setValue(action.inputPlaceholder || '')
							.onChange(async (val) => {
								action.inputPlaceholder = val;
								await this.plugin.saveSettings();
								this.refreshDashboardView();
							}));
				}

				// Delete Button
				new Setting(settingWrap)
					.addButton(btn => btn
						.setButtonText('删除此按钮')
						.setWarning()
						.onClick(async () => {
							this.plugin.settings.claudianActions.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
							this.refreshDashboardView();
						}));
			});

			new Setting(sectionContent)
				.addButton(btn => btn
					.setButtonText('+ 新增智能指令')
					.setCta()
					.onClick(async () => {
						this.plugin.settings.claudianActions.push({
							id: `action-${Date.now()}`,
							label: '新指令',
							icon: 'bot',
							prompt: '',
							requireInput: false
						});
						await this.plugin.saveSettings();
						this.display();
						this.refreshDashboardView();
					}));
		}
	}

	refreshDashboardView() {
		interface DashboardViewInterface {
			render(): void;
		}
		this.app.workspace.getLeavesOfType('vault-os-view').forEach(leaf => {
			const view = leaf.view as unknown as DashboardViewInterface;
			if (view && typeof view.render === 'function') {
				view.render();
			}
		});
	}
}
