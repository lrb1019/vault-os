import { App, TFile, TFolder } from 'obsidian';
import { buildDefaultPeriodicNoteContent, type PeriodicNoteTarget } from '../domain/periodic-note';

interface TemplaterPlugin {
	templater?: {
		create_new_note_from_template?: (templateFile: TFile, folderObj: TFolder, baseName: string, open: boolean) => Promise<unknown>;
	};
}

interface ObsidianAppWithPlugins {
	plugins?: {
		getPlugin(id: string): unknown;
	};
}

export interface PeriodicNoteCreateResult {
	status: 'created' | 'existing' | 'failed';
	path?: string;
	warningMessage?: string;
	errorMessage?: string;
}

/** The only adapter responsible for creating periodic Markdown files. */
export class PeriodicNoteFileService {
	constructor(private readonly app: App) {}

	async create(target: PeriodicNoteTarget, date: Date, templatePath: string): Promise<PeriodicNoteCreateResult> {
		try {
			if (target.filePath.includes('../') || target.filePath.startsWith('../')) {
				throw new Error('周期笔记目标路径无效');
			}
			const existing = this.app.vault.getAbstractFileByPath(target.filePath);
			if (existing instanceof TFile) return { status: 'existing', path: existing.path };
			if (existing) throw new Error('周期笔记目标已被非文件对象占用');

			const folder = await this.ensureFolder(target.folderPath);
			const baseName = target.fileName.replace(/\.md$/iu, '').trim();
			const templateFile = this.getTemplateFile(templatePath);
			const warningMessage = templatePath && !templateFile ? '配置的周期笔记模板不可用，已使用默认模板。' : undefined;

			const templater = (this.app as unknown as ObsidianAppWithPlugins).plugins?.getPlugin('templater-obsidian') as TemplaterPlugin | null | undefined;
			if (templateFile && templater?.templater?.create_new_note_from_template) {
				try {
					const created = await templater.templater.create_new_note_from_template(templateFile, folder, baseName, false);
					if (created instanceof TFile) return { status: 'created', path: created.path };
					const createdFile = this.app.vault.getAbstractFileByPath(target.filePath);
					if (createdFile instanceof TFile) return { status: 'created', path: createdFile.path };
				} catch {
					// The manual template copy below remains a recoverable fallback.
				}
			}

			const content = templateFile
				? await this.app.vault.read(templateFile)
				: buildDefaultPeriodicNoteContent(date, baseName);
			const created = await this.app.vault.create(target.filePath, content);
			return {
				status: 'created',
				path: created.path,
				warningMessage: warningMessage || (templateFile ? 'Templater 不可用，已直接复制模板内容。' : undefined)
			};
		} catch (error) {
			return {
				status: 'failed',
				errorMessage: error instanceof Error ? error.message : '创建周期笔记失败'
			};
		}
	}

	private getTemplateFile(templatePath: string): TFile | null {
		if (!templatePath.trim()) return null;
		const file = this.app.vault.getAbstractFileByPath(templatePath.trim().replace(/^\/+/, ''));
		return file instanceof TFile ? file : null;
	}

	private async ensureFolder(folderPath: string): Promise<TFolder> {
		if (folderPath === '/' || folderPath.trim() === '') return this.app.vault.getRoot();
		const normalized = folderPath.trim().replace(/^\/+|\/+$/g, '');
		if (normalized.split('/').some(part => part === '' || part === '.' || part === '..')) {
			throw new Error('周期笔记目标文件夹无效');
		}

		let currentPath = '';
		for (const part of normalized.split('/')) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(currentPath)) await this.app.vault.createFolder(currentPath);
		}

		const folder = this.app.vault.getAbstractFileByPath(normalized);
		if (!(folder instanceof TFolder)) throw new Error('无法创建周期笔记目标文件夹');
		return folder;
	}
}
