import { App, TFile, TFolder } from 'obsidian';
import AgentDashboardPlugin from '../main';

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
	private plugin: AgentDashboardPlugin;
	private app: App;

	constructor(plugin: AgentDashboardPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
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
						if (file.stat.ctime < oldestTime) {
							oldestTime = file.stat.ctime;
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
				const ctimeDate = new Date(file.stat.ctime);
				const dateString = ctimeDate.toISOString().split('T')[0];
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
	 * Calculates the number of empty markdown notes in the vault (excluding templates, dashboard, config)
	 */
	async getEmptyNotesCount(): Promise<{count: number, files: string[]}> {
		try {
			const files = this.app.vault.getMarkdownFiles();
			let emptyCount = 0;
			const emptyFilesList: string[] = [];
			// Filter candidate files that are small (size < 300 bytes) to save I/O
			const candidates = files.filter(file => 
				file.stat.size < 300 &&
				(file.path.startsWith(this.plugin.settings.atomicsFolder) || file.path.startsWith(this.plugin.settings.outputFolder) || file.path.startsWith(this.plugin.settings.inboxFolder))
			);

			for (const file of candidates) {
				const content = await this.app.vault.read(file);
				const cleanContent = content.replace(/---[\s\S]*?---/, '').trim();
				if (cleanContent === '') {
					emptyCount++;
					emptyFilesList.push(file.path);
				}
			}
			return { count: emptyCount, files: emptyFilesList };
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

			const epochTime = new Date('2025-02-01').getTime();
			const { dailyNoteFolder, inboxFolder, projectsFolder, atomicsFolder, outputFolder } = this.plugin.settings;
			let oldestTime = Date.now();

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

				// Use file.stat.ctime directly — already in memory, no I/O
				const ts = file.stat.ctime;
				if (ts >= epochTime && ts < oldestTime) oldestTime = ts;

				// Date bucket for chart
				const d = new Date(ts);
				const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
				dateCounts.set(k, (dateCounts.get(k) || 0) + 1);
			}

			if (oldestTime === Date.now()) oldestTime = epochTime;
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
