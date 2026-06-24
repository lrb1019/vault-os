import { App, moment } from 'obsidian';

export interface BookProgressInfo {
	bookName: string;
	progressPercent: number;
	lastReadTime: string;
	reflection?: string;
}

interface JarvisReaderProgress {
	percentage?: number;
	updated?: string;
}

interface JarvisReaderHighlight {
	comment?: string;
	created?: string;
}

interface JarvisReaderSettingsShape {
	bookProgress?: Record<string, JarvisReaderProgress>;
	bookHighlights?: Record<string, JarvisReaderHighlight[]>;
}

interface JarvisReaderPluginInstance {
	settings?: JarvisReaderSettingsShape;
}

export class ReadingService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Safely fetch reading progress from the jarvis-reader plugin
	 */
	async getReadingProgress(): Promise<BookProgressInfo[]> {
		try {
			// 1. Try to access the active plugin instance directly (fastest)
			const appWithPlugins = this.app as unknown as {
				plugins?: {
					getPlugin(id: string): JarvisReaderPluginInstance | null;
				};
			};
			const jarvisReaderPlugin = appWithPlugins.plugins?.getPlugin('jarvis-reader');
			
			if (jarvisReaderPlugin && jarvisReaderPlugin.settings) {
				return this.parseProgressFromSettings(jarvisReaderPlugin.settings);
			}

			// 2. Fallback: Read the plugin's data.json directly from the vault adapter
			const dataPath = `${this.app.vault.configDir}/plugins/jarvis-reader/data.json`;
			const exists = await this.app.vault.adapter.exists(dataPath);
			
			if (exists) {
				const dataRaw = await this.app.vault.adapter.read(dataPath);
				const data = JSON.parse(dataRaw) as JarvisReaderSettingsShape;
				return this.parseProgressFromSettings(data);
			}
		} catch (error) {
			console.error('Failed to load reading progress from jarvis-reader:', error);
		}

		// Return empty array if plugin is not found/configured
		return [];
	}

	private parseProgressFromSettings(settings: JarvisReaderSettingsShape): BookProgressInfo[] {
		const progressList: BookProgressInfo[] = [];
		const progressMap = settings.bookProgress || {};
		
		for (const bookPath of Object.keys(progressMap)) {
			const progress = progressMap[bookPath];
			if (progress) {
				// Clean book name from path (e.g. "books/Design.epub" -> "Design")
				const bookName = bookPath.split('/').pop()?.replace('.epub', '') || bookPath;
				
				progressList.push({
					bookName: bookName.startsWith('《') ? bookName : `《${bookName}》`,
					progressPercent: Math.round(progress.percentage || 0),
					lastReadTime: this.formatRelativeTime(progress.updated || ''),
					reflection: this.extractReflectionForBook(bookPath, settings)
				});
			}
		}

		// Sort by last read time descending
		return progressList.sort((a, b) => b.lastReadTime.localeCompare(a.lastReadTime));
	}

	private extractReflectionForBook(bookPath: string, settings: JarvisReaderSettingsShape): string | undefined {
		const highlights = settings.bookHighlights?.[bookPath] || [];
		if (highlights.length > 0) {
			// Find the latest highlight with a comment/reflection
			const comments = highlights
				.filter((h): h is JarvisReaderHighlight & { comment: string } => 
					typeof h.comment === 'string' && h.comment.trim() !== ''
				);

			if (comments.length === 0) return undefined;

			const sorted = comments.sort((a, b) => {
				const timeA = a.created ? moment(a.created).valueOf() : 0;
				const timeB = b.created ? moment(b.created).valueOf() : 0;
				return timeB - timeA;
			});

			return sorted[0]?.comment;
		}
		return undefined;
	}

	private formatRelativeTime(dateStr: string): string {
		if (!dateStr) return '未知时间';
		try {
			const date = new Date(dateStr);
			const diffMs = Date.now() - date.getTime();
			const diffMins = Math.floor(diffMs / 60000);
			const diffHours = Math.floor(diffMins / 60);
			const diffDays = Math.floor(diffHours / 24);

			if (diffMins < 60) return `${diffMins}分钟前`;
			if (diffHours < 24) return `${diffHours}小时前`;
			if (diffDays === 1) return '昨天';
			return `${diffDays}天前`;
		} catch {
			return '最近';
		}
	}
}
