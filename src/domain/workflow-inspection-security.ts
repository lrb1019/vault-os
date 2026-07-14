import { matchesScopeRule, type ScopeRule, type VaultFileDescriptor } from './vault-profile.ts';

/** A path-only exclusion can be applied before any frontmatter is read. */
export function isPathSafeExclusion(rule: ScopeRule): boolean {
	if (rule.type === 'folder') return rule.paths.some(path => path.trim() !== '');
	if (rule.type !== 'compound') return false;
	return rule.rules.length > 0 && rule.rules.every(isPathSafeExclusion);
}

export function getPathSafeExclusions(exclusions: readonly ScopeRule[]): ScopeRule[] {
	return exclusions.filter(isPathSafeExclusion);
}

export interface WorkflowInspectionSecurityState {
	status: 'ready' | 'blocked';
	reason?: string;
	pathSafeExclusions: ScopeRule[];
}

/**
 * Semantic inspection fails closed until at least one confirmed path-level
 * global exclusion exists. Tag/property exclusions cannot protect content
 * before metadata has already been read.
 */
export function assessWorkflowInspectionSecurity(exclusions: readonly ScopeRule[]): WorkflowInspectionSecurityState {
	const pathSafeExclusions = getPathSafeExclusions(exclusions);
	if (pathSafeExclusions.length === 0) {
		return {
			status: 'blocked',
			reason: '请先确认至少一条按文件夹排除的全局安全范围。',
			pathSafeExclusions
		};
	}
	if (pathSafeExclusions.length !== exclusions.length) {
		return {
			status: 'blocked',
			reason: '工作流巡检只接受按文件夹配置的全局排除；请将标签或属性排除改为路径排除后再运行。',
			pathSafeExclusions
		};
	}
	return { status: 'ready', pathSafeExclusions };
}

/** Reuses ScopeRule matching for the pre-metadata path safety gate. */
export function isExcludedBeforeMetadataRead(file: VaultFileDescriptor, exclusions: readonly ScopeRule[]): boolean {
	return exclusions.some(rule => matchesScopeRule(file, rule));
}
