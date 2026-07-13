import { Plugin } from 'obsidian';
import { VaultOsView, VIEW_TYPE_VAULT_OS } from './DashboardView';
import { VaultOsSettings, DEFAULT_SETTINGS, VaultOsSettingTab } from './settings';

type LegacyTickTickSettings = VaultOsSettings & {
	mcpConfigPath?: unknown;
	ticktickMcp?: unknown;
	ticktickCachePath?: unknown;
	ticktickSyncDebounce?: unknown;
};

export default class VaultOsPlugin extends Plugin {
	settings!: VaultOsSettings;
	private settingsWriteQueue: Promise<void> = Promise.resolve();

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_VAULT_OS,
			(leaf) => new VaultOsView(leaf, this)
		);

		this.addRibbonIcon('waypoints', 'Open Vault OS', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-dashboard',
			name: 'Open dashboard',
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
		const legacySettings = this.settings as LegacyTickTickSettings;
		const hasLegacyTickTickSettings = ['mcpConfigPath', 'ticktickMcp', 'ticktickCachePath', 'ticktickSyncDebounce']
			.some(key => Object.prototype.hasOwnProperty.call(legacySettings, key));
		delete legacySettings.mcpConfigPath;
		delete legacySettings.ticktickMcp;
		delete legacySettings.ticktickCachePath;
		delete legacySettings.ticktickSyncDebounce;
		if (hasLegacyTickTickSettings) await this.saveData(this.settings);
	}

	async saveSettings() {
		const write = this.settingsWriteQueue.catch(() => undefined).then(async () => {
			await this.saveData(this.settings);
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_OS);
			for (const leaf of leaves) {
				if (leaf.view instanceof VaultOsView) {
					leaf.view.render();
				}
			}
		});
		this.settingsWriteQueue = write;
		return write;
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
