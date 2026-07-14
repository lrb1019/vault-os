import { matchesScopeRule, type ScopeRule, type VaultFileDescriptor } from './vault-profile.ts';

export type KnowledgeEntityKind = 'question' | 'claim' | 'evidence';

export interface KnowledgeEntityContract {
	questions?: ScopeRule;
	claims?: ScopeRule;
	evidence?: ScopeRule;
	questionClaimRelation?: 'bidirectional-wiki-link';
	outputClaimRelation?: 'outbound-wiki-link';
	evidenceClaimRelation?: 'supports';
}

export const CURRENT_VAULT_KNOWLEDGE_ENTITY_CONTRACT: Required<KnowledgeEntityContract> = {
	questions: { type: 'compound', operator: 'or', rules: [
		{ type: 'property', key: 'type', values: ['Question'] },
		{ type: 'property', key: 'card_type', values: ['question'] }
	] },
	claims: { type: 'compound', operator: 'or', rules: [
		{ type: 'property', key: 'type', values: ['Claim'] },
		{ type: 'property', key: 'card_type', values: ['claim'] }
	] },
	evidence: { type: 'compound', operator: 'or', rules: [
		{ type: 'property', key: 'type', values: ['Evidence'] },
		{ type: 'property', key: 'card_type', values: ['evidence'] }
	] },
	questionClaimRelation: 'bidirectional-wiki-link',
	outputClaimRelation: 'outbound-wiki-link',
	evidenceClaimRelation: 'supports'
};

export function isKnowledgeEntityContractConfigured(contract: KnowledgeEntityContract | undefined): contract is Required<KnowledgeEntityContract> {
	return Boolean(contract?.questions && contract.claims && contract.evidence
		&& contract.questionClaimRelation && contract.outputClaimRelation && contract.evidenceClaimRelation);
}

export function classifyKnowledgeEntity(file: VaultFileDescriptor, contract: Required<KnowledgeEntityContract>): KnowledgeEntityKind | undefined {
	if (matchesScopeRule(file, contract.questions)) return 'question';
	if (matchesScopeRule(file, contract.claims)) return 'claim';
	if (matchesScopeRule(file, contract.evidence)) return 'evidence';
	return undefined;
}
