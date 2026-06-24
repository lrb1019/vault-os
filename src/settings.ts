import { App, PluginSettingTab, Setting } from 'obsidian';
import AgentDashboardPlugin from './main';

export interface ClaudianAction {
	id: string;
	label: string;
	icon: string;
	prompt: string;
	requireInput: boolean;
	inputPlaceholder?: string;
}

export interface AgentDashboardSettings {
	dashboardTitle: string;
	enabledShortcuts: Record<string, boolean>;
	claudianActions: ClaudianAction[];
}

export const DEFAULT_SETTINGS: AgentDashboardSettings = {
	dashboardTitle: "BYLRB 的智能控制中心",
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
		{ id: 'action-1', label: '快捷入库 (Ingest)', icon: 'bot', prompt: '@skills/ingest 请帮我整理并分类 01 Daily 中的未入库日记。注意：在生成双向链接时，请只保留文件名，严禁包含前面的文件夹路径（例如，必须是 [[笔记名字]]，绝对不能是 [[01 Daily/笔记名字]] 或 [[02 Inbox/笔记名字]]），否则移动到归档后双链会失效！', requireInput: false },
		{ id: 'action-2', label: '全面体检 (Lint)', icon: 'bot', prompt: '@skills/lint 请帮我扫描并体检整个知识库，找出孤儿笔记与死链并协助修复', requireInput: false },
		{ id: 'action-3', label: '清理空白 (Clean)', icon: 'bot', prompt: '@skills/lint 请帮我清理库中的所有空白笔记', requireInput: false },
		{ id: 'action-4', label: '文档审计 (Review)', icon: 'bot', prompt: '@skills/research 请对当前项目与知识库进行全面审计并输出优化意见', requireInput: false },
		{ id: 'action-5', label: '检索', icon: 'bot', prompt: '@skills/query 请帮我检索关于“{{input}}”的内容', requireInput: true, inputPlaceholder: '输入要查询的知识主题...' },
		{ id: 'action-6', label: '研究', icon: 'bot', prompt: '@skills/research 请针对“{{input}}”这一主题开展深度主题研究', requireInput: true, inputPlaceholder: '输入要研究的主题/方向...' }
	]
};

export class AgentDashboardSettingTab extends PluginSettingTab {
	plugin: AgentDashboardPlugin;

	constructor(app: App, plugin: AgentDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('看板基础设置')
			.setHeading();

		new Setting(containerEl)
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

		new Setting(containerEl)
			.setName('快捷入口显示设置')
			.setDesc('选择在看板中显示的常用插件快捷入口或核心技能按钮')
			.setHeading();

		new Setting(containerEl)
			.setName('核心工作流技能')
			.setHeading();

		const coreSkills = [
			{ id: 'ingest', name: '快捷入库 (/ingest)' },
			{ id: 'lint', name: '库体检 (/lint)' },
			{ id: 'query', name: '知识检索 (/query)' },
			{ id: 'research', name: '主题研究 (/research)' }
		];

		coreSkills.forEach(skill => {
			new Setting(containerEl)
				.setName(skill.name)
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enabledShortcuts[skill.id] ?? true)
					.onChange(async (value) => {
						this.plugin.settings.enabledShortcuts[skill.id] = value;
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));
		});

		new Setting(containerEl)
			.setName('第三方插件联动（自动检测已安装）')
			.setHeading();

		const manifests = (this.app as any).plugins?.manifests || {};
		const thirdPartyPlugins = [
			{ id: 'jarvis-reader', name: 'Jarvis Reader (阅读统计与分析)' },
			{ id: 'notebook-navigator', name: 'Notebook Navigator (双栏目录与日历)' },
			{ id: 'rss-dashboard', name: 'RSS Dashboard (阅读订阅聚合)' },
			{ id: 'dataview', name: 'Dataview (数据索引查询)' },
			{ id: 'obsidian-tasks-plugin', name: 'Tasks (待办任务管理)' },
			{ id: 'obsidian-excalidraw-plugin', name: 'Excalidraw (手绘思维导图)' },
			{ id: 'templater-obsidian', name: 'Templater (高级日记模板)' }
		];

		let hasThirdParty = false;
		thirdPartyPlugins.forEach(plugin => {
			if (manifests[plugin.id]) {
				hasThirdParty = true;
				new Setting(containerEl)
					.setName(plugin.name)
					.setDesc('检测到已安装此插件，切换是否在看板展示快捷按钮')
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.enabledShortcuts[plugin.id] ?? true)
						.onChange(async (value) => {
							this.plugin.settings.enabledShortcuts[plugin.id] = value;
							await this.plugin.saveSettings();
							this.refreshDashboardView();
						}));
			}
		});

		if (!hasThirdParty) {
			containerEl.createEl('p', {
				text: '未检测到匹配的联动插件（如 jarvis-reader 等）。请在社区插件市场安装对应插件。',
				cls: 'setting-item-description',
				attr: { style: 'color: var(--text-warning); font-style: italic;' }
			});
		}

		new Setting(containerEl)
			.setName('自定义智能指令 (Claudian Actions)')
			.setDesc('自定义底部技能面板的按钮。支持动态获取输入框内容（请使用 {{input}} 占位符）。图标请使用 Lucide Icon 名称。')
			.setHeading();

		this.plugin.settings.claudianActions.forEach((action, index) => {
			const settingWrap = containerEl.createDiv({ cls: 'ad-setting-action-item', attr: { style: 'border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 12px; margin-bottom: 12px; position: relative;' } });
			
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
				.setDesc('点击后发送的指令内容，支持 {{input}}。')
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
				.setDesc('如果开启，按钮左侧会提供一个输入框。')
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
					.setButtonText('删除此指令')
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.claudianActions.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
						this.refreshDashboardView();
					}));
		});

		new Setting(containerEl)
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

	refreshDashboardView() {
		this.app.workspace.getLeavesOfType('agent-dashboard-view').forEach(leaf => {
			const view = leaf.view as any;
			if (view && typeof view.render === 'function') {
				view.render();
			}
		});
	}
}
