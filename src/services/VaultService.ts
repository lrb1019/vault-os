import { App, TFile } from 'obsidian';
import VaultOsPlugin from '../main';
import { createLegacyVaultProfile, isVaultProfile, resolveScope, unionScopeRules, type ScopeRule, type VaultProfile } from '../domain/vault-profile';

export interface InboxBacklogInfo {
	count: number;
	oldestDays: number;
	needRouting: number;
	files: string[];
}

export interface ContributionDay {
	date: string;
	count: number;
	level: 0 | 1 | 2 | 3 | 4;
}

export interface VaultOverviewStats {
	totalMdFiles: number;
	totalDays: number;
	dailyAvg: number;

	countDaily: number;
	countInbox: number;

	countAtomics: number;
	countOutput: number;
	countOther: number;

	countOrphans: number;
}

export class VaultService {
	private plugin: VaultOsPlugin;
	private app: App;

	constructor(plugin: VaultOsPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	private getVaultProfile(): VaultProfile {
		const configuredProfile = this.plugin.settings.vaultProfile;
		if (isVaultProfile(configuredProfile)) return configuredProfile;

		return createLegacyVaultProfile({
			dailyNoteFolder: this.plugin.settings.dailyNoteFolder,
			inboxFolder: this.plugin.settings.inboxFolder,
			atomicsFolder: this.plugin.settings.atomicsFolder,
			outputFolder: this.plugin.settings.outputFolder
		});
	}

	private getMarkdownDescriptors(): Array<{ file: TFile; path: string; tags: string[]; properties: Record<string, unknown> | undefined }> {
		return this.app.vault.getMarkdownFiles().map(file => {
			const cache = this.app.metadataCache.getFileCache(file);
			return {
				file,
				path: file.path,
				tags: cache?.tags?.map(tag => tag.tag) || [],
				properties: cache?.frontmatter
			};
		});
	}

	private resolveMarkdownFiles(scope: ScopeRule): TFile[] {
		return resolveScope(this.getMarkdownDescriptors(), scope, this.getVaultProfile().exclusions).map(descriptor => descriptor.file);
	}

	private resolveMarkdownFilesForScopes(scopes: readonly (ScopeRule | undefined)[]): TFile[] {
		const include = unionScopeRules(scopes);
		if (!include) return [];
		return this.resolveMarkdownFiles(include);
	}

	private getJournalDailyScope(profile: VaultProfile): ScopeRule | undefined {
		return profile.journal.provider === 'manual' ? profile.journal.daily : undefined;
	}

	private parseFrontmatterDate(value: unknown): number | null {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === 'string' && value.trim() !== '') {
			const parsed = new Date(value).getTime();
			return Number.isNaN(parsed) ? null : parsed;
		}
		if (value instanceof Date) {
			const parsed = value.getTime();
			return Number.isNaN(parsed) ? null : parsed;
		}
		return null;
	}

	private parseDailyFilenameDate(file: TFile): number | null {
		if (!file.path.startsWith(this.plugin.settings.dailyNoteFolder)) {
			return null;
		}
		const match = file.basename.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
		if (!match) {
			return null;
		}
		const [, year, month, day] = match;
		if (!year || !month || !day) {
			return null;
		}
		return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
	}

	private formatLocalDate(ts: number): string {
		const d = new Date(ts);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	resolveLogicalCreatedAt(file: TFile): number {
		const dailyDate = this.parseDailyFilenameDate(file);
		if (dailyDate !== null) {
			return dailyDate;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const created = this.parseFrontmatterDate(frontmatter?.created);
		if (created !== null) {
			return created;
		}

		return file.stat.ctime;
	}

	resolveLastActivityAt(file: TFile): number {
		return file.stat.mtime;
	}

	private resolveRepositoryCreatedAt(file: TFile): number {
		return file.stat.ctime;
	}

	getVaultLifetimeDays(): number {
		const files = this.app.vault.getMarkdownFiles().filter(file => !file.path.includes('.trash') && !file.path.startsWith('.'));
		if (files.length === 0) {
			return 0;
		}

		let earliest = Number.POSITIVE_INFINITY;
		for (const file of files) {
			const ts = this.resolveRepositoryCreatedAt(file);
			if (ts < earliest) {
				earliest = ts;
			}
		}

		if (!Number.isFinite(earliest)) {
			return 0;
		}
		return Math.max(1, Math.ceil((Date.now() - earliest) / 86400000));
	}

	/**
	 * Scans the configured Inbox scope. Legacy folder settings remain a non-recursive compatibility profile.
	 */
	async getInboxBacklog(): Promise<InboxBacklogInfo> {
		try {
			const inboxScope = this.getVaultProfile().inbox;
			if (!inboxScope) return { count: 0, oldestDays: 0, needRouting: 0, files: [] };

			const files = this.resolveMarkdownFiles(inboxScope);
			let oldestTime = Date.now();
			for (const file of files) {
				const createdAt = this.resolveLogicalCreatedAt(file);
				if (createdAt < oldestTime) oldestTime = createdAt;
			}

			const count = files.length;
			return {
				count,
				oldestDays: count > 0 ? Math.floor((Date.now() - oldestTime) / 86400000) : 0,
				needRouting: count,
				files: files.map(file => file.path)
			};
		} catch (error) {
			console.error('Failed to scan inbox folder:', error);
		}

		return { count: 0, oldestDays: 0, needRouting: 0, files: [] };
	}

	/**
	 * Calculates the number of orphan files (markdown files that are not linked by any other files)
	 */
	async getOrphanCount(): Promise<{count: number, files: string[]}> {
		try {
			const profile = this.getVaultProfile();
			const files = this.resolveMarkdownFilesForScopes([profile.knowledge]);
			const linkSourcePaths = new Set(this.resolveMarkdownFilesForScopes([
				profile.knowledge,
				profile.outputs,
				this.getJournalDailyScope(profile)
			]).map(file => file.path));
			const resolvedLinks = this.app.metadataCache.resolvedLinks;
			
			const linkedFiles = new Set<string>();
			for (const sourcePath of Object.keys(resolvedLinks)) {
				// Exclude generated indexes and reports from the configured link evidence scope.
				if (sourcePath.includes('Index')) continue;
				if (sourcePath.includes('体检报告')) continue;
				if (!linkSourcePaths.has(sourcePath)) continue;

				const targets = resolvedLinks[sourcePath];
				if (targets) {
					for (const targetPath of Object.keys(targets)) {
						linkedFiles.add(targetPath);
					}
				}
			}
			
			let orphanCount = 0;
			const orphans: string[] = [];
			files.forEach(file => {
				if (!linkedFiles.has(file.path) && !file.name.includes('Index')) {
					orphanCount++;
					orphans.push(file.path);
				}
			});
			
			return { count: orphanCount, files: orphans };
		} catch (e) {
			console.error('Failed to calculate orphan count:', e);
			return { count: 0, files: [] };
		}
	}

	/**
	 * Calculates the number of dead links (unresolved links) in the vault
	 */
	async getDeadLinkCount(): Promise<{count: number, files: string[]}> {
		try {
			const profile = this.getVaultProfile();
			const linkSourcePaths = new Set(this.resolveMarkdownFilesForScopes([
				profile.knowledge,
				profile.outputs,
				profile.inbox
			]).map(file => file.path));
			const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
			let deadLinksCount = 0;
			const deadLinksList: string[] = [];
			
			for (const sourcePath of Object.keys(unresolvedLinks)) {
				if (!linkSourcePaths.has(sourcePath)) continue;
				const targets = unresolvedLinks[sourcePath];
				if (targets) {
					for (const target of Object.keys(targets)) {
						deadLinksCount++;
						deadLinksList.push(`[[${target}]] in ${sourcePath}`);
					}
				}
			}
			
			return { count: deadLinksCount, files: deadLinksList };
		} catch (e) {
			console.error('Failed to calculate dead links:', e);
			return { count: 0, files: [] };
		}
	}

	/**
	 * Scans vault files for creation statistics to build the contribution heatmap.
	 * Scans all markdown files in the vault and maps creation dates.
	 */
	async getVaultHeatmapData(daysCount: number = 105): Promise<ContributionDay[]> {
		const data: ContributionDay[] = [];
		const now = new Date();
		const dateMap: Record<string, number> = {};

		try {
			const files = this.app.vault.getMarkdownFiles();
			files.forEach(file => {
				const dateString = this.formatLocalDate(this.resolveLogicalCreatedAt(file));
				if (dateString) {
					dateMap[dateString] = (dateMap[dateString] || 0) + 1;
				}
			});
		} catch (error) {
			console.error('Failed to calculate heatmap stats:', error);
		}

		// Fill in date series for the last `daysCount` days ending today
		for (let i = daysCount - 1; i >= 0; i--) {
			const date = new Date(now);
			date.setDate(now.getDate() - i);
			const dateString = date.toISOString().split('T')[0] || '';
			const count = dateMap[dateString] || 0;
			
			// Map count to levels 0-4
			let level: 0 | 1 | 2 | 3 | 4 = 0;
			if (count > 8) level = 4;
			else if (count > 5) level = 3;
			else if (count > 2) level = 2;
			else if (count > 0) level = 1;

			data.push({
				date: dateString,
				count,
				level
			});
		}

		return data;
	}

	/** Scans the configured daily journal scope for files not yet marked as ingested. */
	async getUningestedDiariesCount(): Promise<{count: number, files: string[]}> {
		try {
			const journalScope = this.getJournalDailyScope(this.getVaultProfile());
			if (!journalScope) return { count: 0, files: [] };

			const uningestedFiles = this.resolveMarkdownFiles(journalScope)
				.filter(file => this.app.metadataCache.getFileCache(file)?.frontmatter?.ingested !== true)
				.map(file => file.path);
			return { count: uningestedFiles.length, files: uningestedFiles };
		} catch (e) {
			console.error('Failed to calculate un-ingested diaries:', e);
		}
		return { count: 0, files: [] };
	}

	/**
	 * Treats a note as empty when, after removing frontmatter and pure heading lines,
	 * no body content remains.
	 */
	private isStructurallyEmptyMarkdown(content: string): boolean {
		const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '');
		const withoutHeadings = withoutFrontmatter.replace(/^\s{0,3}#{1,6}\s+.*$/gmu, '');
		return withoutHeadings.trim() === '';
	}

	async getEmptyNoteFiles(): Promise<TFile[]> {
		const emptyFiles: TFile[] = [];
		try {
			const files = this.resolveMarkdownFiles({ type: 'all-markdown' });
			for (const file of files) {
				const content = await this.app.vault.read(file);
				if (this.isStructurallyEmptyMarkdown(content)) {
					emptyFiles.push(file);
				}
			}
		} catch (e) {
			console.error('Failed to collect empty notes:', e);
		}
		return emptyFiles;
	}

	/**
	 * Calculates the number of empty markdown notes across the vault.
	 */
	async getEmptyNotesCount(): Promise<{count: number, files: string[]}> {
		try {
			const emptyFiles = await this.getEmptyNoteFiles();
			return { count: emptyFiles.length, files: emptyFiles.map(file => file.path) };
		} catch (e) {
			console.error('Failed to calculate empty notes:', e);
		}
		return { count: 0, files: [] };
	}

	/**
	 * Single-pass scan: computes both VaultOverviewStats and date counts.
	 * Uses file.stat.ctime only — no per-file metadataCache.getFileCache calls.
	 */
	computeVaultData(): { stats: VaultOverviewStats; dateCounts: Map<string, number> } {
		const stats: VaultOverviewStats = {
			totalMdFiles: 0, totalDays: 0, dailyAvg: 0,
			countDaily: 0, countInbox: 0,
			countAtomics: 0, countOutput: 0, countOther: 0, countOrphans: 0
		};
		const dateCounts = new Map<string, number>();

		try {
			let files = this.app.vault.getMarkdownFiles();
			files = files.filter(f => !f.path.includes('.trash') && !f.path.startsWith('.'));
			stats.totalMdFiles = files.length;
			if (stats.totalMdFiles === 0) return { stats, dateCounts };

			// Orphan detection: uses resolvedLinks (single object access, no per-file cache)
			const resolvedLinks = this.app.metadataCache.resolvedLinks;
			const linkedFiles = new Set<string>();
			for (const sourcePath of Object.keys(resolvedLinks)) {
				if (sourcePath.includes('Index') || sourcePath.includes('体检报告')) continue;
				if (!sourcePath.startsWith(this.plugin.settings.atomicsFolder) &&
					!sourcePath.startsWith(this.plugin.settings.outputFolder) &&
					!sourcePath.startsWith(this.plugin.settings.dailyNoteFolder)) continue;
				const targets = resolvedLinks[sourcePath];
				if (targets) for (const t of Object.keys(targets)) linkedFiles.add(t);
			}

			const { dailyNoteFolder, inboxFolder, atomicsFolder, outputFolder } = this.plugin.settings;
			let oldestTime = Number.POSITIVE_INFINITY;

			for (const file of files) {
				const path = file.path;

				// Categorize (pure string ops)
				if      (path.startsWith(dailyNoteFolder)) stats.countDaily++;
				else if (path.startsWith(inboxFolder))     stats.countInbox++;
				else if (path.startsWith(atomicsFolder))   stats.countAtomics++;
				else if (path.startsWith(outputFolder))    stats.countOutput++;
				else                                       stats.countOther++;

				// Orphan check
				if (path.startsWith(atomicsFolder) && !linkedFiles.has(path) && !file.name.includes('Index')) {
					stats.countOrphans++;
				}

				const createdAt = this.resolveRepositoryCreatedAt(file);
				if (createdAt < oldestTime) oldestTime = createdAt;

				// Date bucket for chart
				const k = this.formatLocalDate(this.resolveLogicalCreatedAt(file));
				dateCounts.set(k, (dateCounts.get(k) || 0) + 1);
			}

			if (!Number.isFinite(oldestTime)) oldestTime = Date.now();
			stats.totalDays = Math.max(1, Math.ceil((Date.now() - oldestTime) / 86400000));
			stats.dailyAvg = parseFloat((stats.totalMdFiles / stats.totalDays).toFixed(1));

		} catch (error) {
			console.error('Failed to compute vault data:', error);
		}

		return { stats, dateCounts };
	}

	getVaultOverviewStats(): VaultOverviewStats {
		return this.computeVaultData().stats;
	}
}
