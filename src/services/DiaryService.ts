import { App, TFile, moment } from 'obsidian';
import VaultOsPlugin from '../main';
import { createDefaultManualPeriodicConfig, type ManualPeriodicConfig, type PeriodicCycle, type PeriodicNoteTarget, type PeriodicPathProvider } from '../domain/periodic-note';
import { ConfiguredManualPeriodicPathProvider } from './ConfiguredManualPeriodicPathProvider';
import { NotebookNavigatorPeriodicPathProvider } from './NotebookNavigatorPeriodicPathProvider';
import { PeriodicNoteFileService, type PeriodicNoteCreateResult } from './PeriodicNoteFileService';

export interface DiaryInfo {
	isCreated: boolean;
	path: string;
	summary: string;
}

export interface DiaryStats {
	totalDiaries: number;
	totalWeeklies: number;
	totalMonthlies: number;
	totalQuarterlies: number;
	totalYearlies: number;
	totalWords: number;
	totalDays: number;
	maxStreak: number;
}

interface Profile {
	id: string;
	periodicNotesFolder?: string;
}

interface NavigatorSettings {
	vaultProfile?: string;
	vaultProfiles?: Profile[];
	calendarCustomFilePattern?: string;
	calendarCustomWeekPattern?: string;
	calendarCustomMonthPattern?: string;
	calendarCustomQuarterPattern?: string;
	calendarCustomYearPattern?: string;
	calendarCustomFileTemplate?: string;
	calendarCustomWeekTemplate?: string;
	calendarCustomMonthTemplate?: string;
	calendarCustomQuarterTemplate?: string;
	calendarCustomYearTemplate?: string;
}

interface NavigatorPlugin {
	settings: NavigatorSettings;
}

interface ObsidianAppWithPlugins {
	plugins: {
		getPlugin(id: string): unknown;
	};
}

interface NavigatorConfig {
	rootFolder: string;
	patterns: {
		day: string;
		week: string;
		month: string;
		quarter: string;
		year: string;
	};
	templates: {
		day: string;
		week: string;
		month: string;
		quarter: string;
		year: string;
	};
}

export class DiaryService {
	private plugin: VaultOsPlugin;
	private app: App;
	private readonly periodicFiles: PeriodicNoteFileService;

	constructor(plugin: VaultOsPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.periodicFiles = new PeriodicNoteFileService(this.app);
	}

	private parseDiaryDateFromFilename(file: TFile): string | null {
		const match = file.basename.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
		if (!match) {
			return null;
		}
		const [, year, month, day] = match;
		if (!year || !month || !day) {
			return null;
		}
		return `${year}-${month}-${day}`;
	}

	private resolveDiaryDayString(file: TFile): string {
		const fileNameDate = this.parseDiaryDateFromFilename(file);
		if (fileNameDate) {
			return fileNameDate;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		const rawFm: unknown = cache?.frontmatter;
		const frontmatter = rawFm as Record<string, unknown> | undefined;
		const createdVal = frontmatter?.created;
		if (createdVal && (typeof createdVal === 'string' || typeof createdVal === 'number' || createdVal instanceof Date)) {
			const parsed = moment(createdVal);
			if (parsed.isValid()) {
				return parsed.format('YYYY-MM-DD');
			}
		}

		return moment(file.stat.ctime).format('YYYY-MM-DD');
	}

	/**
	 * Retrieve Notebook Navigator plugin settings
	 */
	getNavigatorSettings(): NavigatorConfig | null {
		const appWithPlugins = this.app as unknown as ObsidianAppWithPlugins;
		const navPlugin = appWithPlugins.plugins.getPlugin("notebook-navigator") as NavigatorPlugin | undefined;
		if (!navPlugin) return null;
		
		const settings = navPlugin.settings;
		const activeProfileId = settings?.vaultProfile || "default";
		const activeProfile = settings?.vaultProfiles?.find((p: Profile) => p.id === activeProfileId) || settings?.vaultProfiles?.[0];
		
		return {
			rootFolder: activeProfile?.periodicNotesFolder || this.plugin.settings.dailyNoteFolder,
			patterns: {
				day: settings?.calendarCustomFilePattern || "YYYYMMDD_dddd",
				week: settings?.calendarCustomWeekPattern || "gggg-[W]ww",
				month: settings?.calendarCustomMonthPattern || "YYYY-MM",
				quarter: settings?.calendarCustomQuarterPattern || "YYYY-第Q季度",
				year: settings?.calendarCustomYearPattern || "YYYY-个人年度总结"
			},
			templates: {
				day: settings?.calendarCustomFileTemplate || "",
				week: settings?.calendarCustomWeekTemplate || "",
				month: settings?.calendarCustomMonthTemplate || "",
				quarter: settings?.calendarCustomQuarterTemplate || "",
				year: settings?.calendarCustomYearTemplate || ""
			}
		};
	}

	/**
	 * Resolves paths through a provider while keeping file creation in this service.
	 */
	private getManualPeriodicConfig(): ManualPeriodicConfig {
		return this.plugin.settings.manualPeriodic || createDefaultManualPeriodicConfig(this.plugin.settings.dailyNoteFolder);
	}

	private getPeriodicPathProvider(): PeriodicPathProvider {
		const preference = this.plugin.settings.periodicProvider || 'auto';
		const config = preference === 'manual' ? null : this.getNavigatorSettings();
		if (config) return new NotebookNavigatorPeriodicPathProvider(config);
		return new ConfiguredManualPeriodicPathProvider(this.getManualPeriodicConfig());
	}

	getPeriodicRootFolder(): string {
		const preference = this.plugin.settings.periodicProvider || 'auto';
		const navigatorConfig = preference === 'manual' ? null : this.getNavigatorSettings();
		return navigatorConfig?.rootFolder || this.getManualPeriodicConfig().rootFolder;
	}

	resolvePeriodicNotePath(date: moment.Moment, cycle: PeriodicCycle): PeriodicNoteTarget {
		return this.getPeriodicPathProvider().resolve(date.toDate(), cycle);
	}

	/**
	 * Creates a new periodic note based on Notebook Navigator settings and Templater integration
	 */
	async createPeriodicNote(date: moment.Moment, cycle: PeriodicCycle): Promise<PeriodicNoteCreateResult> {
		const target = this.resolvePeriodicNotePath(date, cycle);
		const navigatorConfig = this.plugin.settings.periodicProvider === 'manual' ? null : this.getNavigatorSettings();
		const templatePath = navigatorConfig?.templates[cycle] || this.getManualPeriodicConfig().templates[cycle];
		return this.periodicFiles.create(target, date.toDate(), templatePath);
	}

	/**
	 * Checks if today's diary note exists and extracts metadata/summary
	 */
	async getTodayDiaryStatus(): Promise<DiaryInfo> {
		const todayMoment = moment();
		const { filePath } = this.resolvePeriodicNotePath(todayMoment, 'day');
		
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			const summary = this.extractSummary(content);
			return {
				isCreated: true,
				path: filePath,
				summary: summary || '今日日记已创建，暂无摘要。'
			};
		}

		return {
			isCreated: false,
			path: filePath,
			summary: '今日日记尚未创建，点击下方 "打开今日日记" 按钮即可基于模板新建。'
		};
	}

	/**
	 * Creates a new daily diary file based on templates
	 */
	async createTodayDiary(): Promise<PeriodicNoteCreateResult> {
		return this.createPeriodicNote(moment(), 'day');
	}

	async getDiaryStats(): Promise<DiaryStats> {
		const diaryRoot = this.plugin.settings.dailyNoteFolder;
		const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(diaryRoot));
		const stats: DiaryStats = {
			totalDiaries: 0,
			totalWeeklies: 0,
			totalMonthlies: 0,
			totalQuarterlies: 0,
			totalYearlies: 0,
			totalWords: 0,
			totalDays: 0,
			maxStreak: 0
		};

		const dayDates: string[] = [];

		for (const f of files) {
			const name = f.basename;
			
			// Count total words roughly based on file size (assuming ~3 bytes per Chinese char, or mixed text)
			stats.totalWords += Math.floor(f.stat.size / 3);

			// Heuristics for classifying periodic notes based on common formats
			if (name.match(/\d{4}-W\d{2}/i) || name.includes('周记')) {
				stats.totalWeeklies++;
			} else if (name.match(/^\d{4}-\d{2}$/) || name.includes('月记')) {
				stats.totalMonthlies++;
			} else if (name.includes('Q') || name.includes('季记')) {
				stats.totalQuarterlies++;
			} else if (name.includes('年') || name.match(/^\d{4}$/)) {
				stats.totalYearlies++;
			} else if (name.match(/^\d{4}-?\d{2}-?\d{2}/) || name.includes('日记')) {
				stats.totalDiaries++;
				dayDates.push(this.resolveDiaryDayString(f));
			} else {
				stats.totalDiaries++;
				dayDates.push(this.resolveDiaryDayString(f));
			}
		}

		stats.totalDays = dayDates.length;

		if (dayDates.length > 0) {
			// Sort dates to calculate streak
			dayDates.sort();
			const uniqueDates = [...new Set(dayDates)];
			let currentStreak = 1;
			let maxStreak = 1;

			for (let i = 1; i < uniqueDates.length; i++) {
				const prev = moment(uniqueDates[i-1], 'YYYY-MM-DD');
				const curr = moment(uniqueDates[i], 'YYYY-MM-DD');
				if (curr.diff(prev, 'days') === 1) {
					currentStreak++;
					maxStreak = Math.max(maxStreak, currentStreak);
				} else {
					currentStreak = 1;
				}
			}
			stats.maxStreak = maxStreak;
		}

		return stats;
	}

	async getLastYearNote(date: moment.Moment, cycle: PeriodicCycle): Promise<DiaryInfo | null> {
		const targetDate = date.clone().subtract(1, 'year');
		const { filePath } = this.resolvePeriodicNotePath(targetDate, cycle);
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			const summary = this.extractSummary(content);
			return {
				isCreated: true,
				path: filePath,
				summary: summary || '暂无内容概要。'
			};
		}
		return null;
	}

	extractSummary(content: string, length = 150): string {
		// Strip YAML frontmatter entirely
		let textToProcess = content;
		if (content.startsWith('---\n')) {
			const endIdx = content.indexOf('\n---\n');
			if (endIdx !== -1) textToProcess = content.slice(endIdx + 5);
		} else if (content.startsWith('---\r\n')) {
			const endIdx = content.indexOf('\r\n---\r\n');
			if (endIdx !== -1) textToProcess = content.slice(endIdx + 7);
		}

		// Strip markdown elements (headers, images, links, html)
		const plainText = textToProcess
			.replace(/#+\s*/g, '')
			.replace(/!\[.*?\]\(.*?\)/g, '')
			.replace(/\[(.*?)\]\(.*?\)/g, '$1')
			.replace(/<.*?>/g, '')
			.replace(/[\r\n]+/g, ' ')
			.replace(/\s{2,}/g, ' ')
			.trim();

		return plainText ? (plainText.length > length ? plainText.substring(0, length) + '...' : plainText) : '无摘要内容。';
	}
}
