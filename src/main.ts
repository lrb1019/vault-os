import { Plugin } from 'obsidian';
import { AgentDashboardView, VIEW_TYPE_AGENT_DASHBOARD } from './DashboardView';
import { AgentDashboardSettings, DEFAULT_SETTINGS, AgentDashboardSettingTab } from './settings';

export default class AgentDashboardPlugin extends Plugin {
	settings!: AgentDashboardSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_AGENT_DASHBOARD,
			(leaf) => new AgentDashboardView(leaf, this)
		);

		this.addRibbonIcon('layout-dashboard', 'Open agent dashboard', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-dashboard',
			name: 'Open dashboard',
			callback: () => {
				this.activateView();
			}
		});

		this.addSettingTab(new AgentDashboardSettingTab(this.app, this));
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_DASHBOARD);
		for (const leaf of leaves) {
			if (leaf.view instanceof AgentDashboardView) {
				leaf.view.render();
			}
		}
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_AGENT_DASHBOARD);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf(true);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_AGENT_DASHBOARD,
					active: true
				});
			}
		}

		if (leaf) await workspace.revealLeaf(leaf);
	}
}
