import type { ClaimEvidenceDebt, ClaimFile, ClaimUsageSource, EvidenceFile } from './claim-usage.ts';
import { classifyKnowledgeEntity, isKnowledgeEntityContractConfigured, type KnowledgeEntityContract, type KnowledgeEntityKind } from './knowledge-entity-contract.ts';

export interface NonClaimSupportTarget {
	path: string;
	kind: KnowledgeEntityKind | 'unclassified' | 'outside-knowledge';
	entityProperties?: { type?: string; cardType?: string };
}

function asDisplayProperty(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

export interface KnowledgeGraphDiagnostics {
	status: 'unconfigured' | 'configured';
	evidenceWithoutSupports: string[];
	evidenceWithInvalidSupports: string[];
	evidenceWithUnresolvedSupports: string[];
	evidenceWithNonClaimSupports: Array<{ evidencePath: string; targets: NonClaimSupportTarget[] }>;
	questionsWithoutClaimLinks: string[];
	outputsWithoutClaimLinks: string[];
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase();
}

/**
 * These findings only use declared entity types and resolved links. A missing
 * link is a review candidate, not a claim about the note's semantic quality.
 */
export function diagnoseKnowledgeGraph(
	knowledge: readonly (ClaimFile & EvidenceFile & { resolvedLinks: readonly string[] })[],
	outputs: readonly ClaimUsageSource[],
	contract: KnowledgeEntityContract | undefined
): KnowledgeGraphDiagnostics {
	if (!isKnowledgeEntityContractConfigured(contract)) {
		return { status: 'unconfigured', evidenceWithoutSupports: [], evidenceWithInvalidSupports: [], evidenceWithUnresolvedSupports: [], evidenceWithNonClaimSupports: [], questionsWithoutClaimLinks: [], outputsWithoutClaimLinks: [] };
	}
	const questions = knowledge.filter(file => classifyKnowledgeEntity(file, contract) === 'question');
	const claims = knowledge.filter(file => classifyKnowledgeEntity(file, contract) === 'claim');
	const evidence = knowledge.filter(file => classifyKnowledgeEntity(file, contract) === 'evidence');
	const claimPaths = new Set(claims.map(file => normalizePath(file.path)));
	const knowledgeByPath = new Map(knowledge.map(file => [normalizePath(file.path), file]));
	const questionsLinkedFromClaims = new Set(claims.flatMap(claim => claim.resolvedLinks.map(normalizePath)));

	return {
		status: 'configured',
		evidenceWithoutSupports: evidence
			.filter(file => (file.declaredSupports || []).length === 0 && (file.invalidSupports || []).length === 0)
			.map(file => file.path),
		evidenceWithInvalidSupports: evidence.filter(file => (file.invalidSupports || []).length > 0).map(file => file.path),
		evidenceWithUnresolvedSupports: evidence.filter(file => (file.unresolvedSupports || []).length > 0).map(file => file.path),
		evidenceWithNonClaimSupports: evidence.flatMap(file => {
			const targets = file.resolvedSupports.flatMap(target => {
				const normalizedTarget = normalizePath(target);
				if (claimPaths.has(normalizedTarget)) return [];
			const targetFile = knowledgeByPath.get(normalizedTarget);
			const kind: NonClaimSupportTarget['kind'] = targetFile
				? classifyKnowledgeEntity(targetFile, contract) || 'unclassified'
				: 'outside-knowledge';
			return [{
				path: target,
				kind,
				entityProperties: targetFile ? {
					type: asDisplayProperty(targetFile.properties?.type),
					cardType: asDisplayProperty(targetFile.properties?.card_type)
				} : undefined
			}];
			});
			return targets.length > 0 ? [{ evidencePath: file.path, targets }] : [];
		}),
		questionsWithoutClaimLinks: questions
			.filter(question => !question.resolvedLinks.some(link => claimPaths.has(normalizePath(link))) && !questionsLinkedFromClaims.has(normalizePath(question.path)))
			.map(question => question.path),
		outputsWithoutClaimLinks: outputs
			.filter(output => !output.resolvedLinks.some(link => claimPaths.has(normalizePath(link))))
			.map(output => output.path)
	};
}

export function activeClaimEvidenceDebt(
	claims: readonly ClaimFile[],
	sources: readonly ClaimUsageSource[],
	evidence: readonly EvidenceFile[],
	findDebt: (claims: readonly ClaimFile[], sources: readonly ClaimUsageSource[], evidence: readonly EvidenceFile[]) => ClaimEvidenceDebt[]
): ClaimEvidenceDebt[] {
	return findDebt(claims, sources, evidence);
}
