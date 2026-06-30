import { Plugin } from 'obsidian';
import { VaultOsView, VIEW_TYPE_VAULT_OS } from './DashboardView';
import { VaultOsSettings, DEFAULT_SETTINGS, VaultOsSettingTab } from './settings';

export default class VaultOsPlugin extends Plugin {
	settings!: VaultOsSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_VAULT_OS,
			(leaf) => new VaultOsView(leaf, this)
		);

		this.addRibbonIcon('layout-dashboard', 'Open Vault OS', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-vault-os',
			name: 'Open Vault OS',
			callback: () => {
				void this.activateView();
			}
		});

		this.addSettingTab(new VaultOsSettingTab(this.app, this));
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Record<string, unknown> | null);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_OS);
		for (const leaf of leaves) {
			if (leaf.view instanceof VaultOsView) {
				leaf.view.render();
			}
		}
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_VAULT_OS);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf(true);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_VAULT_OS,
					active: true
				});
			}
		}

		if (leaf) await workspace.revealLeaf(leaf);
	}
}
