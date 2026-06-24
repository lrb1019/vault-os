import { App, TFile, moment } from 'obsidian';

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

interface TemplaterPlugin {
	templater?: {
		create_new_note_from_template?: (
			templateFile: TFile,
			folderObj: TFile,
			baseName: string,
			open: boolean
		) => Promise<unknown>;
	};
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
	private app: App;

	constructor(app: App) {
		this.app = app;
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
			rootFolder: activeProfile?.periodicNotesFolder || "01 Daily",
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
	 * Resolves the folder path, file name, and full path of a periodic note
	 */
	resolvePeriodicNotePath(date: moment.Moment, cycle: 'day' | 'week' | 'month' | 'quarter' | 'year'): { folderPath: string; fileName: string; filePath: string } {
		const config = this.getNavigatorSettings();
		if (!config) {
			const todayStr = date.format('YYYY-MM-DD');
			return {
				folderPath: '01 Daily',
				fileName: `${todayStr}.md`,
				filePath: `01 Daily/${todayStr}.md`
			};
		}
		
		const pattern = config.patterns[cycle];
		const rootFolder = config.rootFolder;
		
		let folderPattern = '';
		let filePattern = pattern;
		
		let insideBrackets = false;
		let lastSlashIndex = -1;
		for (let i = 0; i < pattern.length; i++) {
			const char = pattern[i];
			if (char === '[') insideBrackets = true;
			else if (char === ']') insideBrackets = false;
			else if (char === '/' && !insideBrackets) {
				lastSlashIndex = i;
			}
		}
		
		if (lastSlashIndex !== -1) {
			folderPattern = pattern.slice(0, lastSlashIndex);
			filePattern = pattern.slice(lastSlashIndex + 1);
		}
		
		const formattedFolderSub = folderPattern ? date.format(folderPattern) : '';
		const formattedFileName = date.format(filePattern).trim();
		
		let folderPath = rootFolder;
		if (formattedFolderSub) {
			folderPath = folderPath ? `${folderPath}/${formattedFolderSub}` : formattedFolderSub;
		}
		
		const cleanFolderName = folderPath.trim().replace(/^\/+|\/+$/g, '');
		const cleanFileName = formattedFileName.endsWith('.md') ? formattedFileName : `${formattedFileName}.md`;
		const filePath = cleanFolderName ? `${cleanFolderName}/${cleanFileName}` : cleanFileName;
		
		return {
			folderPath: cleanFolderName || '/',
			fileName: cleanFileName,
			filePath: filePath
		};
	}

	/**
	 * Creates a new periodic note based on Notebook Navigator settings and Templater integration
	 */
	async createPeriodicNote(date: moment.Moment, cycle: 'day' | 'week' | 'month' | 'quarter' | 'year'): Promise<string> {
		const { folderPath, fileName, filePath } = this.resolvePeriodicNotePath(date, cycle);
		
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			return filePath;
		}
		
		// Ensure folder exists
		if (folderPath && folderPath !== '/') {
			const folderParts = folderPath.split('/');
			let currentPath = '';
			for (const part of folderParts) {
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				const existFolder = this.app.vault.getAbstractFileByPath(currentPath);
				if (!existFolder) {
					await this.app.vault.createFolder(currentPath);
				}
			}
		}
		
		const folderObj = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folderObj instanceof TFile)) {
			if (!folderObj) {
				throw new Error(`Failed to resolve target folder: ${folderPath}`);
			}
		}
		
		const config = this.getNavigatorSettings();
		const templatePath = config?.templates[cycle] || "";
		const baseName = fileName.replace(/\.md$/iu, '').trim();
		
		let templateFile: TFile | null = null;
		if (templatePath) {
			const cleanTemplatePath = templatePath.trim().replace(/^\/+/, '');
			const tFile = this.app.vault.getAbstractFileByPath(cleanTemplatePath);
			if (tFile instanceof TFile) {
				templateFile = tFile;
			}
		}
		
		// Attempt to use Templater plugin if active
		const appWithPlugins = this.app as unknown as ObsidianAppWithPlugins;
		const templaterPlugin = appWithPlugins.plugins.getPlugin("templater-obsidian") as TemplaterPlugin | undefined;
		if (templaterPlugin && templaterPlugin.templater && typeof templaterPlugin.templater.create_new_note_from_template === 'function' && templateFile && folderObj instanceof TFile) {
			try {
				const createdFile = await templaterPlugin.templater.create_new_note_from_template(templateFile, folderObj, baseName, false);
				if (createdFile instanceof TFile) {
					return createdFile.path;
				}
			} catch (e) {
				console.error("Templater failed, falling back to manual template copy:", e);
			}
		}
		
		// Fallback: Create file manually and copy template content
		let content = '';
		if (templateFile) {
			content = await this.app.vault.read(templateFile);
		} else {
			content = `---\ncreated: ${date.format('YYYY-MM-DD')}\nauthor: "[[Jarvis]]"\ningested: false\n---\n\n# ${baseName}\n`;
		}
		
		await this.app.vault.create(filePath, content);
		return filePath;
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
	async createTodayDiary(): Promise<string> {
		return this.createPeriodicNote(moment(), 'day');
	}

	async getDiaryStats(): Promise<DiaryStats> {
		const files = this.app.vault.getMarkdownFiles();
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
			const path = f.path;
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
				const match = name.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
				if (match) {
					dayDates.push(`${match[1]}-${match[2]}-${match[3]}`);
				}
			} else if (path.includes('01 Daily')) {
				stats.totalDiaries++;
				const cache = this.app.metadataCache.getFileCache(f);
				if (cache?.frontmatter?.created) {
					const parsed = moment(cache.frontmatter.created);
					if (parsed.isValid()) dayDates.push(parsed.format('YYYY-MM-DD'));
				}
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

	async getLastYearNote(date: moment.Moment, cycle: 'day' | 'week' | 'month' | 'quarter' | 'year'): Promise<DiaryInfo | null> {
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
