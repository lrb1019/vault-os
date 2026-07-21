import { App, TFile } from 'obsidian';
import type VaultOsPlugin from '../main.ts';
import { calculateAgeDays, hasUnresolvedThinking, normalizeThinkingStage, type SynthesisMapNote, type ThinkingMapNote } from '../domain/thinking-map.ts';
import { createLegacyVaultProfile, isVaultProfile, resolveScope, type ScopeRule, type VaultFileDescriptor, type VaultProfile } from '../domain/vault-profile.ts';
import { assessWorkflowInspectionSecurity, isExcludedBeforeMetadataRead } from '../domain/workflow-inspection-security.ts';

export interface ThinkingMapResult {
	status: 'ready' | 'blocked';
	reason?: string;
	developing: ThinkingMapNote[];
	settled: ThinkingMapNote[];
	unclassified: ThinkingMapNote[];
	synthesis: SynthesisMapNote[];
	deadLinks: string[];
	emptyNotes: string[];
}

interface FileFact extends VaultFileDescriptor {
	file: TFile;
}

export class ThinkingMapService {
	constructor(private readonly plugin: VaultOsPlugin, private readonly app: App) {}

	async inspect(now = Date.now()): Promise<ThinkingMapResult> {
		const profile = this.getProfile();
		const security = assessWorkflowInspectionSecurity(profile.exclusions);
		const emptyResult: ThinkingMapResult = {
			status: 'blocked', reason: security.reason, developing: [], settled: [], unclassified: [], synthesis: [], deadLinks: [], emptyNotes: []
		};
		if (security.status === 'blocked') return emptyResult;

		const facts = this.app.vault.getMarkdownFiles()
			.filter(file => !isExcludedBeforeMetadataRead({ path: file.path }, security.pathSafeExclusions))
			.map(file => this.toFact(file));
		const thinkingScope = profile.thinking || this.folderRule(this.plugin.settings.thinkingFolder);
		const synthesisScope = profile.synthesis || this.folderRule(this.plugin.settings.synthesisFolder);
		const thinkingFiles = this.select(facts, thinkingScope, profile);
		const synthesisFiles = this.select(facts, synthesisScope, profile);
		const thinkingPaths = new Set(thinkingFiles.map(fact => fact.path));

		const thinkingNotes = await Promise.all(thinkingFiles.map(async fact => {
			const updatedAt = this.resolveUpdatedAt(fact.file, fact.properties?.last_updated);
			return {
				path: fact.path,
				title: fact.file.basename,
				stage: normalizeThinkingStage(fact.properties?.stage),
				updatedAt,
				ageDays: calculateAgeDays(updatedAt, now),
				hasUnresolved: hasUnresolvedThinking(await this.app.vault.cachedRead(fact.file))
			};
		}));

		const synthesis = synthesisFiles.map(fact => {
			const updatedAt = this.resolveUpdatedAt(fact.file, fact.properties?.last_updated);
			const links = Object.keys(this.app.metadataCache.resolvedLinks[fact.path] || {});
			return {
				path: fact.path,
				title: fact.file.basename,
				updatedAt,
				ageDays: calculateAgeDays(updatedAt, now),
				linkedThinkingCount: links.filter(path => thinkingPaths.has(path)).length
			};
		});

		const activeFiles = [...thinkingFiles, ...synthesisFiles];
		const deadLinks = activeFiles.flatMap(fact => Object.keys(this.app.metadataCache.unresolvedLinks[fact.path] || {})
			.map(target => `[[${target}]] in ${fact.path}`));
		const emptyNotes: string[] = [];
		for (const fact of activeFiles) {
			if (this.isStructurallyEmpty(await this.app.vault.cachedRead(fact.file))) emptyNotes.push(fact.path);
		}

		const newestFirst = <T extends { updatedAt: number }>(items: T[]) => items.sort((a, b) => b.updatedAt - a.updatedAt);
		return {
			status: 'ready',
			developing: newestFirst(thinkingNotes.filter(note => note.stage === 'developing')),
			settled: newestFirst(thinkingNotes.filter(note => note.stage === 'settled')),
			unclassified: newestFirst(thinkingNotes.filter(note => note.stage === 'unclassified')),
			synthesis: newestFirst(synthesis),
			deadLinks,
			emptyNotes
		};
	}

	private getProfile(): VaultProfile {
		if (isVaultProfile(this.plugin.settings.vaultProfile)) return this.plugin.settings.vaultProfile;
		return createLegacyVaultProfile(this.plugin.settings);
	}

	private toFact(file: TFile): FileFact {
		const cache = this.app.metadataCache.getFileCache(file);
		return { file, path: file.path, tags: cache?.tags?.map(tag => tag.tag) || [], properties: cache?.frontmatter };
	}

	private select(facts: FileFact[], scope: ScopeRule | undefined, profile: VaultProfile): FileFact[] {
		return scope ? resolveScope(facts, scope, profile.exclusions) : [];
	}

	private folderRule(path: string): ScopeRule | undefined {
		const normalized = path.trim();
		return normalized ? { type: 'folder', paths: [normalized], recursive: true } : undefined;
	}

	private resolveUpdatedAt(file: TFile, value: unknown): number {
		if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
			const parsed = new Date(value).getTime();
			if (!Number.isNaN(parsed)) return parsed;
		}
		return file.stat.mtime;
	}

	private isStructurallyEmpty(content: string): boolean {
		const body = content
			.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '')
			.replace(/^\s{0,3}#{1,6}\s+.*$/gmu, '')
			.replace(/%%[\s\S]*?%%/gu, '')
			.trim();
		return body === '';
	}
}
