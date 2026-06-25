import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';
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
	
	dailyNoteFolder: string;
	inboxFolder: string;
	projectsFolder: string;
	archiveFolder: string;
	outputFolder: string;
	atomicsFolder: string;
	
	// MCP & Integration settings (new settings)
	mcpConfigPath: string;
	ticktickCachePath: string;
	ticktickServiceName: string;
	ticktickSyncDebounce: number;
	
	// Heatmap & Scale settings (new settings)
	heatmapCellSize: number;
	heatmapCellGap: number;
	heatmapDoubleCellSize: number;
	heatmapDoubleCellGap: number;
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
		{ id: 'action-1', label: '快捷入库 (Ingest)', icon: 'bot', prompt: '@skills/ingest 请帮我整理并分类 {{daily_path}} 中的未入库日记。注意：在生成双向链接时，请只保留文件名，严禁包含前面的文件夹路径（例如，必须是 [[笔记名字]]，绝对不能是 [[{{daily_path}}/笔记名字]] 或 [[{{inbox_path}}/笔记名字]]），否则移动到归档后双链会失效！', requireInput: false },
		{ id: 'action-2', label: '全面体检 (Lint)', icon: 'bot', prompt: '@skills/lint 请帮我扫描并体检整个知识库，找出孤儿笔记与死链并协助修复', requireInput: false },
		{ id: 'action-3', label: '清理空白 (Clean)', icon: 'bot', prompt: '@skills/lint 请帮我清理库中的所有空白笔记', requireInput: false },
		{ id: 'action-4', label: '文档审计 (Review)', icon: 'bot', prompt: '@skills/research 请对当前项目与知识库进行全面审计并输出优化意见', requireInput: false },
		{ id: 'action-5', label: '检索', icon: 'bot', prompt: '@skills/query 请帮我检索关于“{{input}}”的内容', requireInput: true, inputPlaceholder: '输入要查询的知识主题...' },
		{ id: 'action-6', label: '研究', icon: 'bot', prompt: '@skills/research 请针对“{{input}}”这一主题开展深度主题研究', requireInput: true, inputPlaceholder: '输入要研究的主题/方向...' }
	],
	dailyNoteFolder: "01 Daily",
	inboxFolder: "02 Inbox",
	projectsFolder: "03 Projects",
	archiveFolder: "06 Archive",
	outputFolder: "05 Output",
	atomicsFolder: "04 Atomics",
	mcpConfigPath: ".claude/mcp.json",
	ticktickCachePath: "07 Jarvis/ticktick-cache.json",
	ticktickServiceName: "ticktick",
	ticktickSyncDebounce: 2000,
	heatmapCellSize: 12,
	heatmapCellGap: 3,
	heatmapDoubleCellSize: 9,
	heatmapDoubleCellGap: 2
};

export class AgentDashboardSettingTab extends PluginSettingTab {
	plugin: AgentDashboardPlugin;
	private activeTab: 'general' | 'paths' | 'mcp' | 'actions' = 'general';

	constructor(app: App, plugin: AgentDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Horizontal tabs menu
		const tabsContainer = containerEl.createDiv({ cls: 'ad-settings-tabs-container' });

		const createTabBtn = (id: 'general' | 'paths' | 'mcp' | 'actions', label: string, icon: string) => {
			const btn = tabsContainer.createDiv({
				cls: `ad-settings-tab-btn ${this.activeTab === id ? 'is-active' : ''}`
			});
			const iconSpan = btn.createSpan({ cls: 'ad-settings-tab-icon' });
			setIcon(iconSpan, icon);
			btn.createSpan({ text: ` ${label}` });
			btn.addEventListener('click', () => {
				this.activeTab = id;
				this.display();
			});
		};

		createTabBtn('general', '看板基础设置', 'layout');
		createTabBtn('paths', '知识库路径', 'folder');
		createTabBtn('mcp', 'TickTick & MCP', 'cpu');
		createTabBtn('actions', '智能指令', 'bot');

		// Render active tab content
		const sectionContent = containerEl.createDiv({ cls: 'ad-settings-section-content' });

		if (this.activeTab === 'general') {
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
				.setName('单年热力图方格尺寸')
				.setDesc('调整单个年份显示时热力图格子的大小 (单位: 像素)')
				.addSlider(slider => slider
					.setLimits(8, 20, 1)
					.setValue(this.plugin.settings.heatmapCellSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.heatmapCellSize = value;
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('单年热力图方格间距')
				.setDesc('调整单个年份显示时热力图格子之间的间隙 (单位: 像素)')
				.addSlider(slider => slider
					.setLimits(1, 8, 1)
					.setValue(this.plugin.settings.heatmapCellGap)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.heatmapCellGap = value;
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('双年热力图方格尺寸')
				.setDesc('调整显示两个年份（如前年与今年）时热力图格子的大小 (单位: 像素)')
				.addSlider(slider => slider
					.setLimits(6, 16, 1)
					.setValue(this.plugin.settings.heatmapDoubleCellSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.heatmapDoubleCellSize = value;
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('双年热力图方格间距')
				.setDesc('调整显示两个年份时热力图格子之间的间隙 (单位: 像素)')
				.addSlider(slider => slider
					.setLimits(1, 6, 1)
					.setValue(this.plugin.settings.heatmapDoubleCellGap)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.heatmapDoubleCellGap = value;
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

		} else if (this.activeTab === 'paths') {
			new Setting(sectionContent)
				.setName('日记文件夹路径')
				.setDesc('扫描或创建日记时的根目录')
				.addText(text => text
					.setPlaceholder('例如: 01 Daily')
					.setValue(this.plugin.settings.dailyNoteFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteFolder = value.trim().replace(/^\/+|\/+$/g, '');
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('收件箱文件夹路径')
				.setDesc('扫描待整理（未入库）文件的收件箱目录')
				.addText(text => text
					.setPlaceholder('例如: 02 Inbox')
					.setValue(this.plugin.settings.inboxFolder)
					.onChange(async (value) => {
						this.plugin.settings.inboxFolder = value.trim().replace(/^\/+|\/+$/g, '');
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('项目管理文件夹路径')
				.setDesc('扫描并形成项目看板监控的文件夹路径')
				.addText(text => text
					.setPlaceholder('例如: 03 Projects')
					.setValue(this.plugin.settings.projectsFolder)
					.onChange(async (value) => {
						this.plugin.settings.projectsFolder = value.trim().replace(/^\/+|\/+$/g, '');
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('数据归档文件夹路径')
				.setDesc('计算占比统计中被归类的已归档目录路径')
				.addText(text => text
					.setPlaceholder('例如: 06 Archive')
					.setValue(this.plugin.settings.archiveFolder)
					.onChange(async (value) => {
						this.plugin.settings.archiveFolder = value.trim().replace(/^\/+|\/+$/g, '');
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('输出成果文件夹路径')
				.setDesc('计算占比统计中被归类的已输出成果目录路径')
				.addText(text => text
					.setPlaceholder('例如: 05 Output')
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value.trim().replace(/^\/+|\/+$/g, '');
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('原子笔记文件夹路径')
				.setDesc('核心内容（原子笔记）在库中的存放目录（用于孤儿笔记与空笔记扫描）')
				.addText(text => text
					.setPlaceholder('例如: 04 Atomics')
					.setValue(this.plugin.settings.atomicsFolder)
					.onChange(async (value) => {
						this.plugin.settings.atomicsFolder = value.trim().replace(/^\/+|\/+$/g, '');
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

		} else if (this.activeTab === 'mcp') {
			new Setting(sectionContent)
				.setName('MCP 配置文件路径')
				.setDesc('读取本地已连接的智能体 MCP 配置文件路径')
				.addText(text => text
					.setPlaceholder('.claude/mcp.json')
					.setValue(this.plugin.settings.mcpConfigPath)
					.onChange(async (value) => {
						this.plugin.settings.mcpConfigPath = value.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(sectionContent)
				.setName('TickTick 缓存文件路径')
				.setDesc('存储从 TickTick 抓取的待办与打卡数据的本地 JSON 路径')
				.addText(text => text
					.setPlaceholder('07 Jarvis/ticktick-cache.json')
					.setValue(this.plugin.settings.ticktickCachePath)
					.onChange(async (value) => {
						this.plugin.settings.ticktickCachePath = value.trim();
						await this.plugin.saveSettings();
						this.refreshDashboardView();
					}));

			new Setting(sectionContent)
				.setName('TickTick MCP 服务标识符')
				.setDesc('MCP 服务器中配置的 TickTick 连接 service 名称')
				.addText(text => text
					.setPlaceholder('ticktick')
					.setValue(this.plugin.settings.ticktickServiceName)
					.onChange(async (value) => {
						this.plugin.settings.ticktickServiceName = value.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(sectionContent)
				.setName('同步防抖延迟 (毫秒)')
				.setDesc('打卡后触发 TickTick 同步的防抖等待时长，防止数据丢失')
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

		} else if (this.activeTab === 'actions') {
			sectionContent.createEl('p', {
				text: '自定义底部技能面板的交互按钮。支持动态获取输入框内容（请使用 {{input}} ）。您也可以在指令模板中使用路径变量，例如 {{daily_path}}、{{inbox_path}} 或 {{projects_path}} 会自动替换为上面所设置的文件夹名称。',
				cls: 'setting-item-description',
				attr: { style: 'margin-bottom: 16px; padding: 0 10px;' }
			});

			this.plugin.settings.claudianActions.forEach((action, index) => {
				const settingWrap = sectionContent.createDiv({ cls: 'ad-setting-action-item', attr: { style: 'border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 12px; margin-bottom: 12px; position: relative;' } });
				
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
					.setDesc('如果开启，按钮左侧会提供一个输入框以供用户临时填写参数。')
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
		this.app.workspace.getLeavesOfType('agent-dashboard-view').forEach(leaf => {
			const view = leaf.view as unknown as DashboardViewInterface;
			if (view && typeof view.render === 'function') {
				view.render();
			}
		});
	}
}
