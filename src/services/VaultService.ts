import { App, TFile, TFolder } from 'obsidian';
import VaultOsPlugin from '../main';

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
	countProjects: number;
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
		const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
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
	 * Scans the 02 Inbox/ directory to calculate backlog file count, age, and routing status
	 */
	async getInboxBacklog(): Promise<InboxBacklogInfo> {
		try {
			const folderPath = this.plugin.settings.inboxFolder;
			// Rule 21: getAbstractFileByPath for folder lookup
			const folder = this.app.vault.getAbstractFileByPath(folderPath);

			if (folder instanceof TFolder) {
				let count = 0;
				let oldestTime = Date.now();
				let needRouting = 0;
				const filesList: string[] = [];

				folder.children.forEach(file => {
					if (file instanceof TFile && file.extension === 'md') {
						count++;
						filesList.push(file.path);
						const createdAt = this.resolveLogicalCreatedAt(file);
						if (createdAt < oldestTime) {
							oldestTime = createdAt;
						}
						// Check frontmatter routing indicators if necessary (mock check)
						needRouting++;
					}
				});

				const oldestDays = count > 0 
					? Math.floor((Date.now() - oldestTime) / (1000 * 60 * 60 * 24)) 
					: 0;

				return { count, oldestDays, needRouting, files: filesList };
			}
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
			const files = this.app.vault.getMarkdownFiles();
			const resolvedLinks = this.app.metadataCache.resolvedLinks;
			
			const linkedFiles = new Set<string>();
			for (const sourcePath of Object.keys(resolvedLinks)) {
				// 排除索引文件，仅统计来自 04 Atomics、05 Output、01 Daily 的链接（对齐 AI 脚本逻辑）
				if (sourcePath.includes('Index')) continue;
				// 排除 AI 生成的体检报告，防止报告本身“超度”了孤儿笔记
				if (sourcePath.includes('体检报告')) continue;
				if (!sourcePath.startsWith(this.plugin.settings.atomicsFolder) && !sourcePath.startsWith(this.plugin.settings.outputFolder) && !sourcePath.startsWith(this.plugin.settings.dailyNoteFolder)) continue;

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
				// Only check files in 04 Atomics for orphans, aligning with lint skill
				if (file.path.startsWith(this.plugin.settings.atomicsFolder)) {
					if (!linkedFiles.has(file.path) && !file.name.includes('Index')) {
						orphanCount++;
						orphans.push(file.path);
					}
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
			const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
			let deadLinksCount = 0;
			const deadLinksList: string[] = [];
			
			for (const sourcePath of Object.keys(unresolvedLinks)) {
				// Only count dead links originating from core content folders
				if (!sourcePath.startsWith(this.plugin.settings.atomicsFolder) && !sourcePath.startsWith(this.plugin.settings.outputFolder) && !sourcePath.startsWith(this.plugin.settings.inboxFolder)) {
					continue;
				}
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

	/**
	 * Scans the 02 Inbox folder for un-ingested daily diaries (files matching YYYY-MM-DD format)
	 */
	async getUningestedDiariesCount(): Promise<{count: number, files: string[]}> {
		try {
			const folderPath = this.plugin.settings.dailyNoteFolder;
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (folder instanceof TFolder) {
				let count = 0;
				const uningestedFiles: string[] = [];
				const files: TFile[] = [];
				
				const scanFolder = (f: TFolder) => {
					for (const child of f.children) {
						if (child instanceof TFile && child.extension === 'md') {
							files.push(child);
						} else if (child instanceof TFolder) {
							scanFolder(child);
						}
					}
				};
				scanFolder(folder);

				for (const file of files) {
					const cache = this.app.metadataCache.getFileCache(file);
					const frontmatter = cache?.frontmatter;
					if (!frontmatter || frontmatter.ingested !== true) {
						count++;
						uningestedFiles.push(file.path);
					}
				}
				return { count, files: uningestedFiles };
			}
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

	private shouldIgnoreForEmptyNoteScan(file: TFile): boolean {
		const normalizedPath = file.path.replace(/\\/g, '/').toLowerCase();
		return normalizedPath.startsWith('00templates/')
			|| normalizedPath.startsWith('00 templates/')
			|| normalizedPath.startsWith('09books/')
			|| normalizedPath.startsWith('09 books/');
	}

	async getEmptyNoteFiles(): Promise<TFile[]> {
		const emptyFiles: TFile[] = [];
		try {
			const files = this.app.vault.getMarkdownFiles();
			for (const file of files) {
				if (this.shouldIgnoreForEmptyNoteScan(file)) {
					continue;
				}
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
			countDaily: 0, countInbox: 0, countProjects: 0,
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

			const { dailyNoteFolder, inboxFolder, projectsFolder, atomicsFolder, outputFolder } = this.plugin.settings;
			let oldestTime = Number.POSITIVE_INFINITY;

			for (const file of files) {
				const path = file.path;

				// Categorize (pure string ops)
				if      (path.startsWith(dailyNoteFolder)) stats.countDaily++;
				else if (path.startsWith(inboxFolder))     stats.countInbox++;
				else if (path.startsWith(projectsFolder))  stats.countProjects++;
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
