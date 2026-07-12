import { App } from 'obsidian';
import { discoverInboxScopeCandidates, type ScopeRuleCandidate } from '../domain/vault-profile-discovery';

/** Adapts Obsidian metadata into read-only, user-confirmed profile candidates. */
export class VaultProfileDiscoveryService {
	constructor(private readonly app: App) {}

	discoverInboxScopeCandidates(): ScopeRuleCandidate[] {
		const files = this.app.vault.getMarkdownFiles().map(file => {
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
