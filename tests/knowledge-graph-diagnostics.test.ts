import assert from 'node:assert/strict';
import test from 'node:test';
import { CURRENT_VAULT_KNOWLEDGE_ENTITY_CONTRACT, classifyKnowledgeEntity } from '../src/domain/knowledge-entity-contract.ts';
import { diagnoseKnowledgeGraph } from '../src/domain/knowledge-graph-diagnostics.ts';

void test('classifies the existing Question, Claim, and Evidence card conventions', () => {
	assert.equal(classifyKnowledgeEntity({ path: 'Knowledge/Question.md', properties: { type: 'Question' } }, CURRENT_VAULT_KNOWLEDGE_ENTITY_CONTRACT), 'question');
	assert.equal(classifyKnowledgeEntity({ path: 'Knowledge/Claim.md', properties: { card_type: 'claim' } }, CURRENT_VAULT_KNOWLEDGE_ENTITY_CONTRACT), 'claim');
	assert.equal(classifyKnowledgeEntity({ path: 'Knowledge/Evidence.md', properties: { type: 'Evidence' } }, CURRENT_VAULT_KNOWLEDGE_ENTITY_CONTRACT), 'evidence');
});

void test('keeps link gaps as candidates while detecting missing structured supports', () => {
	const result = diagnoseKnowledgeGraph([
		{ path: 'Knowledge/Question.md', properties: { type: 'Question' }, resolvedLinks: [], resolvedSupports: [] },
		{ path: 'Knowledge/Claim.md', properties: { type: 'Claim' }, resolvedLinks: [], resolvedSupports: [] },
		{ path: 'Knowledge/Evidence.md', properties: { type: 'Evidence' }, resolvedLinks: [], resolvedSupports: [] },
		{ path: 'Knowledge/Invalid.md', properties: { type: 'Evidence' }, resolvedLinks: [], resolvedSupports: [], invalidSupports: ['Claim.md'] },
		{ path: 'Knowledge/Unresolved.md', properties: { type: 'Evidence' }, resolvedLinks: [], resolvedSupports: [], declaredSupports: ['[[Missing Claim]]'], unresolvedSupports: ['[[Missing Claim]]'] },
		{ path: 'Knowledge/WrongTarget.md', properties: { type: 'Evidence' }, resolvedLinks: [], resolvedSupports: ['Knowledge/Question.md'], declaredSupports: ['[[Knowledge/Question.md]]'] },
		{ path: 'Knowledge/Supported.md', properties: { type: 'Evidence' }, resolvedLinks: [], resolvedSupports: ['Knowledge/Claim.md'], declaredSupports: ['[[Knowledge/Claim.md]]'] }
	], [{ path: 'Output/Essay.md', kind: 'output', resolvedLinks: [], properties: {}, tags: [] }], CURRENT_VAULT_KNOWLEDGE_ENTITY_CONTRACT);
	assert.deepEqual(result.evidenceWithoutSupports, ['Knowledge/Evidence.md']);
	assert.deepEqual(result.evidenceWithInvalidSupports, ['Knowledge/Invalid.md']);
	assert.deepEqual(result.evidenceWithUnresolvedSupports, ['Knowledge/Unresolved.md']);
	assert.deepEqual(result.evidenceWithNonClaimSupports, [{ evidencePath: 'Knowledge/WrongTarget.md', targets: [{ path: 'Knowledge/Question.md', kind: 'question', entityProperties: { type: 'Question', cardType: undefined } }] }]);
	assert.deepEqual(result.questionsWithoutClaimLinks, ['Knowledge/Question.md']);
	assert.deepEqual(result.outputsWithoutClaimLinks, ['Output/Essay.md']);
});

void test('does not infer a knowledge graph without an explicit entity contract', () => {
	const result = diagnoseKnowledgeGraph([], [], undefined);
	assert.equal(result.status, 'unconfigured');
	assert.deepEqual(result.evidenceWithoutSupports, []);
});
