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
		const addedP0EvidenceDebtAction = await this.installLocalP0EvidenceDebtAction();
		if (hasLegacyTickTickSettings || addedP0EvidenceDebtAction) await this.saveData(this.settings);
	}

	private async installLocalP0EvidenceDebtAction(): Promise<boolean> {
		if (this.settings.p0EvidenceDebtActionInstalled) return false;
		this.settings.p0EvidenceDebtActionInstalled = true;

		const skillPath = '.agents/skills/p0-evidence-debt/SKILL.md';
		if (!await this.app.vault.adapter.exists(skillPath)) return true;

		const actionId = 'p0-evidence-debt';
		if (!(this.settings.claudianActions || []).some(action => action.id === actionId)) {
			this.settings.claudianActions = [
				...(this.settings.claudianActions || []),
				{
					id: actionId,
					label: 'P0 Evidence 补链',
					description: '核验指定 P0 Claim 的来源，先生成 Evidence 预览；确认后才写入。',
					icon: 'waypoints',
					prompt: '@skills/p0-evidence-debt\n请处理以下 P0 Claim（可提供一个或多个 Vault 相对路径）：\n{{input}}\n\n只执行来源核验与 Evidence 草稿预览。不得写入、修改 Claim 或批量扫描；请等待我明确确认后再创建 Evidence。',
					requireInput: true,
					inputPlaceholder: '粘贴 P0 Claim 路径，例如：04 Atomics/某个 Claim.md',
					enabled: true,
					categoryId: 'workflow'
				}
			];
		}

		return true;
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
