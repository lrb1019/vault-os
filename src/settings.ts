import { App, Modal, PluginSettingTab, Setting, setIcon } from 'obsidian';
import VaultOsPlugin from './main';
import { createLegacyVaultProfile, isVaultProfile, type ScopeRule, type VaultProfile } from './domain/vault-profile';
import { VaultProfileDiscoveryService } from './services/VaultProfileDiscoveryService';
import { createDefaultManualPeriodicConfig, type ManualPeriodicConfig, type PeriodicCycle } from './domain/periodic-note';

function stringifyHeaderLines(headers: Record<string, string>): string {
	return Object.entries(headers)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');
}

function parseHeaderLines(raw: string): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const separatorIndex = trimmed.indexOf('=');
		if (separatorIndex <= 0) continue;
		const key = trimmed.slice(0, separatorIndex).trim();
		const value = trimmed.slice(separatorIndex + 1).trim();
		if (key) {
			headers[key] = value;
		}
	}
	return headers;
}

export interface ClaudianAction {
	id: string;
	label: string;
	description?: string;
	icon: string;
	prompt: string;
	requireInput: boolean;
	enabled?: boolean;
	showOnHome?: boolean;
	inputPlaceholder?: string;
}

export interface TickTickMcpConfig {
	enabled: boolean;
	serviceName: string;
	type: 'http';
	url: string;
	headers: Record<string, string>;
}

export interface VaultOsSettings {
	dashboardTitle: string;
	enabledShortcuts: Record<string, boolean>;
	claudianActions: ClaudianAction[];
	
	dailyNoteFolder: string;
	manualPeriodic?: ManualPeriodicConfig;
	periodicProvider?: 'auto' | 'manual' | 'notebook-navigator';
	inboxFolder: string;
	vaultProfile?: VaultProfile;

	archiveFolder: string;
	outputFolder: string;
	atomicsFolder: string;
	
	// Legacy import path for migration / optional fallback
	mcpConfigPath: string;
	ticktickMcp: TickTickMcpConfig;
	ticktickCachePath: string;
	ticktickSyncDebounce: number;
	
	// Heatmap & Scale settings (new settings)
	heatmapCellSize: number;
	heatmapCellGap: number;
	heatmapDoubleCellSize: number;
	heatmapDoubleCellGap: number;
	containerMaxWidth: number;
}

type SettingsTabId = 'general' | 'paths' | 'profile' | 'mcp' | 'actions';
type EditableProfileScope = 'inbox' | 'knowledge' | 'outputs';

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
		{ id: 'action-1', label: '快捷入库 (Ingest)', icon: 'bot', prompt: '@skills/ingest 请帮我整理并分类 {{daily_path}} 中的未入库日记。注意：在生成双向链接时，请只保留文件名，严禁包含前面的文件夹路径（例如，必须是 [[笔记名字]]，绝对不能是 [[{{daily_path}}/笔记名字]] 或 [[{{inbox_path}}/笔记名字]]），否则移动到归档后双链会失效！', requireInput: false },
		{ id: 'action-2', label: '全面体检 (Lint)', icon: 'bot', prompt: '@skills/lint 请帮我扫描并体检整个知识库，找出孤儿笔记与死链并协助修复', requireInput: false },
		{ id: 'action-3', label: '清理空白 (Clean)', icon: 'bot', prompt: '@skills/lint 请帮我清理库中的所有空白笔记', requireInput: false },
		{ id: 'action-4', label: '文档审计 (Review)', icon: 'bot', prompt: '@skills/research 请对当前项目与知识库进行全面审计并输出优化意见', requireInput: false },
		{ id: 'action-5', label: '检索', icon: 'bot', prompt: '@skills/query 请帮我检索关于“{{input}}”的内容', requireInput: true, inputPlaceholder: '输入要查询的知识主题...' },
		{ id: 'action-6', label: '研究', icon: 'bot', prompt: '@skills/research 请针对“{{input}}”这一主题开展深度主题研究', requireInput: true, inputPlaceholder: '输入要研究的主题/方向...' }
	],
	dailyNoteFolder: "01 Daily",
	inboxFolder: "02 Inbox",

	archiveFolder: "06 Archive",
	outputFolder: "05 Output",
	atomicsFolder: "04 Atomics",
	mcpConfigPath: ".claude/mcp.json",
	ticktickMcp: {
		enabled: true,
		serviceName: "ticktick",
		type: "http",
		url: "",
		headers: {}
	},
	ticktickCachePath: "07 Jarvis/ticktick-cache.json",
	ticktickSyncDebounce: 2000,
	heatmapCellSize: 12,
	heatmapCellGap: 3,
	heatmapDoubleCellSize: 9,
	heatmapDoubleCellGap: 2,
	containerMaxWidth: 100
};

class ClaudianActionEditModal extends Modal {
	private readonly originalAction: ClaudianAction;
	private readonly onSaveAction: (action: ClaudianAction) => Promise<void>;
	private readonly onDeleteAction?: () => Promise<void>;

	constructor(app: App, action: ClaudianAction, onSaveAction: (action: ClaudianAction) => Promise<void>, onDeleteAction?: () => Promise<void>) {
		super(app);
		this.originalAction = { ...action };
		this.onSaveAction = onSaveAction;
		this.onDeleteAction = onDeleteAction;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('vo-action-modal');
		contentEl.empty();

		let draft: ClaudianAction = {
			enabled: true,
			...this.originalAction,
			showOnHome: this.originalAction.requireInput ? false : this.originalAction.showOnHome !== false
		};

		contentEl.createEl('h2', { text: 'Edit Smart Action' });

		new Setting(contentEl)
			.setName('按钮名称')
			.setDesc('面板中显示的按钮文字')
			.addText(text => text
				.setPlaceholder('例如：发芽思考')
				.setValue(draft.label)
				.onChange((value) => {
					draft = { ...draft, label: value };
				}));

		new Setting(contentEl)
			.setName('列表描述')
			.setDesc('显示在外层列表里的一句简短说明')
			.addText(text => text
				.setPlaceholder('例如：把碎片灵感发散开，再回库找共鸣')
				.setValue(draft.description || '')
				.onChange((value) => {
					draft = { ...draft, description: value };
				}));

		new Setting(contentEl)
			.setName('图标名称')
			.setDesc('填写 Lucide 图标名称，例如 sprout、book-open、rss')
			.addText(text => text
				.setPlaceholder('例如：bot')
				.setValue(draft.icon)
				.onChange((value) => {
					draft = { ...draft, icon: value };
				}));

		new Setting(contentEl)
			.setName('启用独立输入框')
			.setDesc('开启后只能在体检页的参数区执行，不会直接显示在首页。')
			.addToggle(toggle => toggle
				.setValue(!!draft.requireInput)
				.onChange((value) => {
					draft = {
						...draft,
						requireInput: value,
						showOnHome: value ? false : draft.showOnHome,
						inputPlaceholder: value ? (draft.inputPlaceholder || '') : ''
					};
				}));

		new Setting(contentEl)
			.setName('在首页显示')
			.setDesc('仅适用于不需要输入的指令。关闭后，该指令仍可在体检页使用。')
			.addToggle(toggle => toggle
				.setValue(!draft.requireInput && draft.showOnHome !== false)
				.onChange((value) => {
					draft = { ...draft, showOnHome: value };
				}));

		new Setting(contentEl)
			.setName('输入框提示词')
			.setDesc('只在启用独立输入框时生效')
			.addText(text => text
				.setPlaceholder('例如：输入一个概念或一句灵感')
				.setValue(draft.inputPlaceholder || '')
				.onChange((value) => {
					draft = { ...draft, inputPlaceholder: value };
				}));

		new Setting(contentEl)
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
			const deleteBtn = leftActions.createEl('button', { text: 'Delete', cls: 'mod-warning' });
			deleteBtn.addEventListener('click', () => {
				void this.onDeleteAction?.().then(() => this.close());
			});
		}
		const cancelBtn = rightActions.createEl('button', { text: 'Cancel' });
		const saveBtn = rightActions.createEl('button', { text: 'Save', cls: 'mod-cta' });

		cancelBtn.addEventListener('click', () => this.close());
		saveBtn.addEventListener('click', () => {
			void this.onSaveAction({
				...draft,
				enabled: draft.enabled !== false,
				label: draft.label.trim() || '新指令',
				description: (draft.description || '').trim(),
				icon: draft.icon.trim(),
				prompt: draft.prompt.trim(),
				showOnHome: draft.requireInput ? false : draft.showOnHome !== false,
				inputPlaceholder: draft.requireInput ? (draft.inputPlaceholder || '').trim() : ''
			}).then(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
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
			outputFolder: this.plugin.settings.outputFolder
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

		const ruleType = rule && rule.type !== 'compound' ? rule.type : 'folder';
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

		if (rule?.type === 'folder') {
			new Setting(container)
				.setName(`${name}文件夹`)
				.setDesc('使用逗号分隔多个路径，例如 Inbox, Capture。')
				.addText(text => text
					.setPlaceholder('例如：Inbox, Capture')
					.setValue(rule.paths.join(', '))
					.onChange(async value => {
						const paths = value.split(',').map(path => this.normalizeFolderPath(path)).filter(Boolean);
						await onSave({ type: 'folder', paths, recursive: rule.recursive !== false });
					}));
			new Setting(container)
				.setName('包含子文件夹')
				.setDesc('关闭后，只匹配该目录的直接 Markdown 文件。')
				.addToggle(toggle => toggle
					.setValue(rule.recursive !== false)
					.onChange(async value => {
						await onSave({ type: 'folder', paths: rule.paths, recursive: value });
					}));
		} else if (rule?.type === 'tag') {
			new Setting(container)
				.setName(`${name}标签`)
				.setDesc('使用逗号分隔多个标签，任一标签匹配即可。')
				.addText(text => text
					.setPlaceholder('inbox, capture')
					.setValue(rule.tags.join(', '))
					.onChange(async value => {
						const tags = value.split(',').map(tag => tag.trim()).filter(Boolean);
						await onSave({ type: 'tag', tags });
					}));
		} else if (rule?.type === 'property') {
			new Setting(container)
				.setName('属性名称')
				.setDesc('例如 status、type 或 workflow。')
				.addText(text => text
					.setPlaceholder('status')
					.setValue(rule.key)
					.onChange(async value => {
						await onSave({ type: 'property', key: value.trim(), values: rule.values });
					}));
			new Setting(container)
				.setName('属性值')
				.setDesc('使用逗号分隔多个匹配值。')
				.addText(text => text
					.setPlaceholder('inbox, captured')
					.setValue(rule.values.join(', '))
					.onChange(async value => {
						const values = value.split(',').map(item => item.trim()).filter(Boolean);
						await onSave({ type: 'property', key: rule.key, values });
					}));
		}
	}

	private renderVaultProfileSettings(container: HTMLElement): void {
		const isConfigured = isVaultProfile(this.plugin.settings.vaultProfile);
		const profile = this.getEditableVaultProfile();

		this.createNote(
			container,
			'仓库规则把“日记、收件箱、知识范围”等语义和具体目录分开。兼容模式继续使用下方旧路径；启用自定义规则后，插件会按规则识别文件，不要求复制作者目录。'
		);

		if (!isConfigured) {
			new Setting(container)
				.setName('当前模式：兼容现有路径')
				.setDesc(`收件箱当前按 ${this.plugin.settings.inboxFolder || '未配置路径'} 的直接 Markdown 文件统计。启用后会将现有路径保存为可编辑配置档案。`)
				.addButton(button => button
					.setButtonText('启用可配置仓库规则')
					.setCta()
					.onClick(async () => {
						this.plugin.settings.vaultProfile = profile;
						await this.plugin.saveSettings();
						this.display();
					}));
		}

		const discoveryResults = container.createDiv({ cls: 'vo-settings-note-subtle' });
		new Setting(container)
			.setName('检测现有收件箱规则')
			.setDesc('只读扫描文件路径、标签和 frontmatter，生成候选与证据；不会自动保存或修改任何笔记。')
			.addButton(button => button
				.setButtonText('扫描候选规则')
				.onClick(() => {
					button.setDisabled(true);
					discoveryResults.empty();
					const candidates = new VaultProfileDiscoveryService(this.app).discoverInboxScopeCandidates();
					if (candidates.length === 0) {
						discoveryResults.createEl('p', { text: '没有发现可信候选。请使用下方规则手动配置。' });
					} else {
						discoveryResults.createEl('p', { text: '以下为只读候选。点击“使用此规则”后才会写入插件设置。' });
						for (const candidate of candidates) {
							const row = discoveryResults.createDiv({ attr: { style: 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0;' } });
							const description = row.createDiv();
							description.createDiv({ text: candidate.label });
							description.createDiv({ text: candidate.evidence, cls: 'setting-item-description' });
							const useButton = row.createEl('button', { text: '使用此规则' });
							useButton.addEventListener('click', () => {
								void this.saveProfileRule('inbox', candidate.rule, true);
							});
						}
					}
					button.setDisabled(false);
				}));

		if (!isConfigured) return;

		this.renderScopeRuleEditor(
			container,
			'收件箱范围',
			'影响 Inbox 积压和死链来源；不会移动、修改或创建文件。',
			profile.inbox,
			(rule, rerenderSettings) => this.saveProfileRule('inbox', rule, rerenderSettings)
		);
		this.renderScopeRuleEditor(
			container,
			'知识范围',
			'影响孤儿候选和死链来源。',
			profile.knowledge,
			(rule, rerenderSettings) => this.saveProfileRule('knowledge', rule, rerenderSettings)
		);
		this.renderScopeRuleEditor(
			container,
			'输出范围',
			'影响死链与孤儿的链接证据来源。',
			profile.outputs,
			(rule, rerenderSettings) => this.saveProfileRule('outputs', rule, rerenderSettings)
		);

		this.createNote(
			container,
			`当前有 ${profile.exclusions.length} 条全局排除规则。组合条件和排除规则编辑器将在下一阶段加入；当前规则不会修改仓库内容。`,
			'vo-settings-note-subtle'
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
			showOnHome: true,
			inputPlaceholder: ''
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
		return {
			enabled: true,
			description: '',
			inputPlaceholder: '',
			...action,
			showOnHome: action.requireInput ? false : action.showOnHome !== false
		};
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
				new ClaudianActionEditModal(this.app, action, async (nextAction) => {
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
				text: (action.description || '').trim() || (action.requireInput ? '需要输入，仅在体检页执行' : action.showOnHome === false ? '不在首页显示' : '首页直接执行'),
				cls: 'vo-actions-compact-desc'
			});

			const right = row.createDiv({ cls: 'vo-actions-compact-controls' });
			const editBtn = right.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': '编辑指令' } });
			setIcon(editBtn, 'pencil');
			editBtn.addEventListener('click', () => {
				new ClaudianActionEditModal(
					this.app,
					action,
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

	private renderActionPreview(sectionContent: HTMLElement): void {
		const enabledActions = (this.plugin.settings.claudianActions || [])
			.map(action => this.normalizeAction(action))
			.filter(action => action.enabled !== false);
		const iconOnlyActions = enabledActions.filter(action => !action.requireInput && action.showOnHome !== false);
		const inputActions = enabledActions.filter(action => action.requireInput);

		const previewSection = sectionContent.createDiv({ cls: 'vo-actions-preview-section' });
		this.createSectionHeading(previewSection, '面板预览');

		const iconCard = previewSection.createDiv({ cls: 'vo-actions-preview-card' });
		iconCard.createDiv({ text: '纯按钮区', cls: 'vo-actions-preview-label' });
		const iconGrid = iconCard.createDiv({ cls: 'vo-actions-preview-grid vo-actions-preview-grid-four' });
		iconOnlyActions.forEach(action => {
			const btn = iconGrid.createDiv({ cls: 'vo-actions-preview-button' });
			const iconWrap = btn.createDiv({ cls: 'vo-actions-preview-button-icon' });
			setIcon(iconWrap, action.icon || 'bot');
			btn.createSpan({ text: action.label });
		});

		const inputCard = previewSection.createDiv({ cls: 'vo-actions-preview-card' });
		inputCard.createDiv({ text: '输入框区', cls: 'vo-actions-preview-label' });
		const inputGrid = inputCard.createDiv({ cls: 'vo-actions-preview-grid vo-actions-preview-grid-two' });
		inputActions.forEach(action => {
			const row = inputGrid.createDiv({ cls: 'vo-actions-preview-input-row' });
			row.createEl('input', {
				type: 'text',
				placeholder: action.inputPlaceholder || '',
				attr: { disabled: 'true' }
			});
			const btn = row.createDiv({ cls: 'vo-actions-preview-input-button' });
			const iconWrap = btn.createDiv({ cls: 'vo-actions-preview-button-icon' });
			setIcon(iconWrap, action.icon || 'bot');
			btn.createSpan({ text: action.label });
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

		createTabBtn('general', '看板基础设置', 'layout');
		createTabBtn('paths', '知识库路径', 'folder');
		createTabBtn('profile', '仓库规则', 'sliders-horizontal');
		createTabBtn('mcp', 'TickTick 连接', 'cpu');
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

			return;

		} else if (this.activeTab === 'paths') {
			const manualPeriodic = this.getManualPeriodicConfig();
			const periodicNames: Record<PeriodicCycle, string> = {
				day: '日记', week: '周记', month: '月记', quarter: '季记', year: '年记'
			};
			this.createNote(
				sectionContent,
				'这里不是随便填路径，而是在定义整个插件的数据口径。日记就是“日记文件夹里的全部内容”；巡检核心就是“原子笔记文件夹里的全部内容”；项目则由项目文件夹和 Base 文件共同决定。'
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

			new Setting(sectionContent)
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

			new Setting(sectionContent)
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
				new Setting(sectionContent)
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
				new Setting(sectionContent)
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
				.setDesc('用于收件箱积压统计，以及快速分流时的默认来源目录。')
				.addText(text => text
					.setPlaceholder('例如: 02 Inbox')
					.setValue(this.plugin.settings.inboxFolder)
					.onChange(async (value) => {
						this.plugin.settings.inboxFolder = this.normalizeFolderPath(value);
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('巡检核心文件夹路径')
				.setDesc('孤儿笔记默认只检查这里；死链统计也会优先结合这里一起判断。它本质上就是你的原子笔记主目录。')
				.addText(text => text
					.setPlaceholder('例如: 04 Atomics')
					.setValue(this.plugin.settings.atomicsFolder)
					.onChange(async (value) => {
						this.plugin.settings.atomicsFolder = this.normalizeFolderPath(value);
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));



			new Setting(sectionContent)
				.setName('数据归档文件夹路径')
				.setDesc('仓库概览里会把这个目录下的文件归为归档内容。')
				.addText(text => text
					.setPlaceholder('例如: 06 Archive')
					.setValue(this.plugin.settings.archiveFolder)
					.onChange(async (value) => {
						this.plugin.settings.archiveFolder = this.normalizeFolderPath(value);
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('输出成果文件夹路径')
				.setDesc('仓库概览会将这里归类为输出内容；部分巡检链接来源也会把这里纳入参考。')
				.addText(text => text
					.setPlaceholder('例如: 05 Output')
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = this.normalizeFolderPath(value);
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			this.createNote(
				sectionContent,
				'补充说明：空白笔记清理目前仍按全库扫描，而不是只看某一个文件夹。这是为了覆盖“空文件、只有标题、只有属性没有正文”的所有笔记。',
				'vo-settings-note-subtle'
			);

			} else if (this.activeTab === 'profile') {
				this.renderVaultProfileSettings(sectionContent);
				return;

			} else if (this.activeTab === 'mcp') {
			this.createNote(
				sectionContent,
				'TickTick 连接现在由本插件独立管理，不再和其他插件共用 MCP 配置文件。这里保留的都是当前真正会影响连接结果的字段。'
			);
			this.createNote(
				sectionContent,
				'本地缓存文件由插件内部自动读写，不需要再单独暴露给设置页。只有在你明确知道自己要改什么时，才需要动下面的高级字段。',
				'vo-settings-note-subtle'
			);

			new Setting(sectionContent)
				.setName('TickTick 连接启用状态')
				.setDesc('关闭后，面板将不再尝试请求 TickTick MCP 接口。')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.ticktickMcp.enabled)
					.onChange(async (value) => {
						this.plugin.settings.ticktickMcp.enabled = value;
						await this.plugin.saveSettings();
					}));

			new Setting(sectionContent)
				.setName('TickTick 接口地址')
				.setDesc('HTTP 类型 MCP 端点地址，例如 https://mcp.ticktick.com')
				.addText(text => text
					.setPlaceholder('https://mcp.ticktick.com')
					.setValue(this.plugin.settings.ticktickMcp.url)
					.onChange(async (value) => {
						this.plugin.settings.ticktickMcp.url = value.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(sectionContent)
				.setName('TickTick 请求头')
				.setDesc('每行一个 key=value，例如 Authorization=Bearer ...')
				.addTextArea(text => text
					.setPlaceholder('Authorization=Bearer ...')
					.setValue(stringifyHeaderLines(this.plugin.settings.ticktickMcp.headers))
					.onChange(async (value) => {
						this.plugin.settings.ticktickMcp.headers = parseHeaderLines(value);
						await this.plugin.saveSettings();
					}));

			new Setting(sectionContent)
				.setName('TickTick 服务标识符')
				.setDesc('高级项。用于插件内部识别该连接，通常保持 ticktick 即可。')
				.addText(text => text
					.setPlaceholder('ticktick')
					.setValue(this.plugin.settings.ticktickMcp.serviceName)
					.onChange(async (value) => {
						this.plugin.settings.ticktickMcp.serviceName = value.trim() || 'ticktick';
						await this.plugin.saveSettings();
					}));

			new Setting(sectionContent)
				.setName('同步防抖延迟 (毫秒)')
				.setDesc('打卡后触发 TickTick 二次同步前的等待时长，避免接口延迟覆盖最新状态。')
				.addText(text => text
					.setPlaceholder('2000')
					.setValue(String(this.plugin.settings.ticktickSyncDebounce))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num)) {
							this.plugin.settings.ticktickSyncDebounce = num;
							await this.plugin.saveSettings();
						}
					}));
			return;

		} else if (this.activeTab === 'actions') {
			this.createNote(
				sectionContent,
				'这里配置的是巡检页底部的自定义 Skill 按钮。它们不会自己执行内容，而是把你写好的指令模板转交给 Claudian（realclaudian）插件。'
			);
			this.createNote(
				sectionContent,
				'需要用户临时输入内容时，请在模板里使用 {{input}}。如果你改了上面的日记 / Inbox / 项目等路径，这里的 {{daily_path}}、{{inbox_path}} 也会自动跟着替换。',
				'vo-settings-note-subtle'
			);
			this.createLucideNote(sectionContent);
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
