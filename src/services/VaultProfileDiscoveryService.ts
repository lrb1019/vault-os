import { App } from 'obsidian';
import { discoverInboxScopeCandidates, type ScopeRuleCandidate } from '../domain/vault-profile-discovery';
import type { ScopeRule } from '../domain/vault-profile';
import { assessWorkflowInspectionSecurity, isExcludedBeforeMetadataRead } from '../domain/workflow-inspection-security';

/** Adapts Obsidian metadata into read-only, user-confirmed profile candidates. */
export class VaultProfileDiscoveryService {
	constructor(private readonly app: App) {}

	discoverInboxScopeCandidates(exclusions: readonly ScopeRule[]): ScopeRuleCandidate[] {
		const security = assessWorkflowInspectionSecurity(exclusions);
		if (security.status === 'blocked') return [];
		const files = this.app.vault.getMarkdownFiles()
			.filter(file => !isExcludedBeforeMetadataRead({ path: file.path }, security.pathSafeExclusions))
			.map(file => {
			const cache = this.app.metadataCache.getFileCache(file);
			return {
				path: file.path,
				tags: cache?.tags?.map(tag => tag.tag) || [],
				properties: cache?.frontmatter
			};
			});

		return discoverInboxScopeCandidates(files);
	}
}
