import { App } from 'obsidian';
import { parseDailyReadingReflections, type DailyReadingReflection } from '../domain/daily-reflection';
import { resolveScope, type ScopeRule } from '../domain/vault-profile';

export class DailyReadingReflectionService {
	constructor(private readonly app: App) {}

	async getReflections(scope: ScopeRule | undefined): Promise<DailyReadingReflection[]> {
		if (!scope) return [];
		const files = resolveScope(
			this.app.vault.getMarkdownFiles().map(file => {
				const cache = this.app.metadataCache.getFileCache(file);
				return { file, path: file.path, tags: cache?.tags?.map(tag => tag.tag) || [], properties: cache?.frontmatter };
			}),
			scope
		).map(item => item.file);
		const contents = await Promise.all(files.map(async file => ({ file, content: await this.app.vault.read(file) })));
		return contents.flatMap(({ file, content }) => parseDailyReadingReflections(content, file.path));
	}

	openReflection(reflection: DailyReadingReflection): void {
		void this.app.workspace.openLinkText(`${reflection.filePath}#^${reflection.blockId}`, '', false);
	}
}
