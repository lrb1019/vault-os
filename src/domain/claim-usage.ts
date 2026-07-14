import { matchesScopeRule, type ScopeRule, type VaultFileDescriptor } from './vault-profile.ts';

export type ClaimUsageSourceKind =
	| 'project-entity'
	| 'output'
	| 'index'
	| 'template'
	| 'health-report'
	| 'evidence-debt-report'
	| 'audit-document'
	| 'project-management'
	| 'other';

export interface ClaimFile extends VaultFileDescriptor {
	path: string;
}

export interface ClaimUsageSource extends VaultFileDescriptor {
	path: string;
	kind: ClaimUsageSourceKind;
	resolvedLinks: readonly string[];
}

export interface EvidenceFile {
	path: string;
	resolvedSupports: readonly string[];
	declaredSupports?: readonly string[];
	invalidSupports?: readonly string[];
	unresolvedSupports?: readonly string[];
}

export interface ClaimEvidenceDebt {
	claimPath: string;
	usagePaths: string[];
}

function normalizeValue(value: unknown): string {
	return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase();
}

export function isClaimFile(file: ClaimFile): boolean {
	return normalizeValue(file.properties?.type) === 'claim'
		|| normalizeValue(file.properties?.card_type) === 'claim';
}

export function isEligibleClaimUsageSource(
	source: ClaimUsageSource,
	usageSourceExclusions: readonly ScopeRule[] = []
): boolean {
	if (source.kind !== 'project-entity' && source.kind !== 'output') return false;
	return !usageSourceExclusions.some(rule => matchesScopeRule(source, rule));
}

/**
 * Finds structurally used Claim entities that have no Evidence.supports
 * relationship. Entity selection is intentionally performed by the caller's
 * configured contract, rather than inferred from this rule.
 */
export function findClaimEvidenceDebt(
	claims: readonly ClaimFile[],
	sources: readonly ClaimUsageSource[],
	evidence: readonly EvidenceFile[],
	usageSourceExclusions: readonly ScopeRule[] = []
): ClaimEvidenceDebt[] {
	const evidenceTargets = new Set(evidence.flatMap(file => file.resolvedSupports.map(normalizePath)));
	const eligibleSources = sources.filter(source => isEligibleClaimUsageSource(source, usageSourceExclusions));

	return claims
		.map(claim => {
			const claimPath = normalizePath(claim.path);
			const usagePaths = eligibleSources
				.filter(source => source.resolvedLinks.some(target => normalizePath(target) === claimPath))
				.map(source => source.path);
			return { claimPath: claim.path, usagePaths };
		})
		.filter(issue => issue.usagePaths.length > 0 && !evidenceTargets.has(normalizePath(issue.claimPath)));
}

/** @deprecated Use findClaimEvidenceDebt. P0 is a caller-provided filter, not an implicit rule. */
export const findP0ClaimEvidenceDebt = findClaimEvidenceDebt;
