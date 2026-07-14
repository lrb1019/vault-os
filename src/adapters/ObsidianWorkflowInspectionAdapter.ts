import { App, TFile } from 'obsidian';
import { parseSupportsReferences } from '../domain/supports-reference.ts';
import { resolveScope, type ScopeRule, type VaultProfile } from '../domain/vault-profile.ts';
import { assessWorkflowInspectionSecurity, isExcludedBeforeMetadataRead } from '../domain/workflow-inspection-security.ts';
import type { WorkflowInspectionFile, WorkflowInspectionSourceData, WorkflowInspectionSourcePort } from '../ports/WorkflowInspectionSourcePort.ts';

export class ObsidianWorkflowInspectionAdapter implements WorkflowInspectionSourcePort {
	constructor(private readonly app: App) {}

	read(profile: VaultProfile): WorkflowInspectionSourceData {
		const security = assessWorkflowInspectionSecurity(profile.exclusions);
		if (security.status === 'blocked') return { security, projects: [], outputs: [], knowledge: [] };

		const safeFiles = this.app.vault.getMarkdownFiles()
			.filter(file => !isExcludedBeforeMetadataRead({ path: file.path }, security.pathSafeExclusions));
		const facts = safeFiles.map(file => this.toFact(file));
		const select = (scope: ScopeRule | undefined): WorkflowInspectionFile[] => scope
			? resolveScope(facts, scope, profile.exclusions)
			: [];

		return {
			security,
			projects: select(profile.projects),
			projectEntries: profile.projectEntries,
			outputs: select(profile.outputs),
			outputEntries: profile.outputEntries,
			knowledge: select(profile.knowledge)
		};
	}

	private toFact(file: TFile): WorkflowInspectionFile {
		const cache = this.app.metadataCache.getFileCache(file);
		const supports = parseSupportsReferences(cache?.frontmatter?.supports);
		const resolvedSupports: string[] = [];
		const unresolvedSupports: string[] = [];
		for (const reference of supports.references) {
			const target = this.app.metadataCache.getFirstLinkpathDest(reference.linkpath, file.path)?.path;
			if (target) resolvedSupports.push(target);
			else unresolvedSupports.push(reference.raw);
		}
		return {
			path: file.path,
			tags: cache?.tags?.map(tag => tag.tag) || [],
			properties: cache?.frontmatter,
			resolvedLinks: Object.keys(this.app.metadataCache.resolvedLinks[file.path] || {}),
			resolvedSupports,
			declaredSupports: supports.references.map(reference => reference.raw),
			invalidSupports: supports.invalidValues,
			unresolvedSupports
		};
	}
}
