import assert from 'node:assert/strict';
import test from 'node:test';
import type VaultOsPlugin from '../src/main.ts';
import type { VaultProfile } from '../src/domain/vault-profile.ts';
import { CURRENT_VAULT_KNOWLEDGE_ENTITY_CONTRACT } from '../src/domain/knowledge-entity-contract.ts';
import { WorkflowInspectionService } from '../src/services/WorkflowInspectionService.ts';
import type { WorkflowInspectionSourceData, WorkflowInspectionSourcePort } from '../src/ports/WorkflowInspectionSourcePort.ts';

class MemorySource implements WorkflowInspectionSourcePort {
	private readonly data: WorkflowInspectionSourceData;
	constructor(data: WorkflowInspectionSourceData) { this.data = data; }
	read(): WorkflowInspectionSourceData { return this.data; }
}

const profile: VaultProfile = {
	schemaVersion: 1,
	id: 'test', label: 'Test', journal: { provider: 'unconfigured' },
	projects: { type: 'folder', paths: ['Projects'] },
	knowledge: { type: 'folder', paths: ['Atomics'] },
	p0ClaimRule: { type: 'folder', paths: ['Atomics'] },
	knowledgeEntities: CURRENT_VAULT_KNOWLEDGE_ENTITY_CONTRACT,
	exclusions: [{ type: 'folder', paths: ['Secrets'] }]
};

function service(data: WorkflowInspectionSourceData): WorkflowInspectionService {
	return new WorkflowInspectionService({ settings: { vaultProfile: profile } } as unknown as VaultOsPlugin, new MemorySource(data));
}

void test('blocks semantic diagnosis without exposing candidates', () => {
	const result = service({ security: { status: 'blocked', reason: 'configure exclusion', pathSafeExclusions: [] }, projects: [], outputs: [], knowledge: [] }).inspect();
	assert.deepEqual(result, {
		status: 'blocked', reason: 'configure exclusion', completedProjectPaths: [], activeClaimEvidenceDebt: [], p0ClaimDebt: [], p0ClaimEvidence: 'configured',
		knowledgeGraph: { status: 'unconfigured', evidenceWithoutSupports: [], evidenceWithInvalidSupports: [], evidenceWithUnresolvedSupports: [], evidenceWithNonClaimSupports: [], questionsWithoutClaimLinks: [], outputsWithoutClaimLinks: [] },
		publishedUnreviewedOutputPaths: [], outputLifecycle: 'unconfigured'
	});
});

void test('returns completed Project entities and P0 debt without guessing Output lifecycle', () => {
	const result = service({
		security: { status: 'ready', pathSafeExclusions: [] },
		projects: [
			{ path: 'Projects/Alpha/Alpha.md', tags: [], properties: { status: '🔵 Completed' }, resolvedLinks: ['Atomics/Claim.md'], resolvedSupports: [] },
			{ path: 'Projects/Alpha/Plan.md', tags: [], properties: { status: 'completed' }, resolvedLinks: ['Atomics/Claim.md'], resolvedSupports: [] }
		],
		outputs: [],
		knowledge: [{ path: 'Atomics/Claim.md', tags: [], properties: { type: 'claim' }, resolvedLinks: [], resolvedSupports: [] }]
	}).inspect();

	assert.equal(result.status, 'ready');
	assert.deepEqual(result.completedProjectPaths, ['Projects/Alpha/Alpha.md']);
	assert.deepEqual(result.p0ClaimDebt, [{ claimPath: 'Atomics/Claim.md', usagePaths: ['Projects/Alpha/Alpha.md'] }]);
	assert.equal(result.p0ClaimEvidence, 'configured');
	assert.equal(result.outputLifecycle, 'unconfigured');
});

void test('flags published Outputs only after lifecycle and entry rules are configured', () => {
	const lifecycleProfile: VaultProfile = {
		...profile,
		outputEntries: { type: 'folder', paths: ['Output'] },
		outputLifecycle: { published: ['published'], reviewed: ['reviewed'] }
	};
	const result = new WorkflowInspectionService({ settings: { vaultProfile: lifecycleProfile } } as unknown as VaultOsPlugin, new MemorySource({
		security: { status: 'ready', pathSafeExclusions: [] }, projects: [], knowledge: [],
		outputs: [
			{ path: 'Output/Published.md', tags: [], properties: { status: 'published' }, resolvedLinks: [], resolvedSupports: [] },
			{ path: 'Output/Reviewed.md', tags: [], properties: { status: 'reviewed' }, resolvedLinks: [], resolvedSupports: [] }
		],
		outputEntries: { type: 'folder', paths: ['Output'] }
	})).inspect();
	assert.deepEqual(result.publishedUnreviewedOutputPaths, ['Output/Published.md']);
	assert.equal(result.outputLifecycle, 'configured');
});

void test('leaves published-looking Output silent when lifecycle configuration is incomplete', () => {
	const result = service({
		security: { status: 'ready', pathSafeExclusions: [] }, projects: [], knowledge: [],
		outputs: [{ path: 'Output/Published.md', tags: [], properties: { status: 'published' }, resolvedLinks: [], resolvedSupports: [] }],
		outputEntries: { type: 'folder', paths: ['Output'] }
	}).inspect();
	assert.equal(result.outputLifecycle, 'unconfigured');
	assert.deepEqual(result.publishedUnreviewedOutputPaths, []);
});

void test('leaves P0 Claim evidence debt unconfigured until an explicit P0 rule exists', () => {
	const profileWithoutP0: VaultProfile = { ...profile };
	delete profileWithoutP0.p0ClaimRule;
	const result = new WorkflowInspectionService({ settings: { vaultProfile: profileWithoutP0 } } as unknown as VaultOsPlugin, new MemorySource({
		security: { status: 'ready', pathSafeExclusions: [] },
		projects: [{ path: 'Projects/Alpha/Alpha.md', tags: [], properties: { layer: 'project', status: 'completed' }, resolvedLinks: ['Atomics/Claim.md'], resolvedSupports: [] }],
		outputs: [],
		knowledge: [{ path: 'Atomics/Claim.md', tags: [], properties: { type: 'claim' }, resolvedLinks: [], resolvedSupports: [] }]
	})).inspect();
	assert.equal(result.p0ClaimEvidence, 'unconfigured');
	assert.deepEqual(result.p0ClaimDebt, []);
});

void test('does not treat an Output health report as P0 Claim usage', () => {
	const lifecycleProfile: VaultProfile = { ...profile, outputEntries: { type: 'folder', paths: ['Output'] } };
	const result = new WorkflowInspectionService({ settings: { vaultProfile: lifecycleProfile } } as unknown as VaultOsPlugin, new MemorySource({
		security: { status: 'ready', pathSafeExclusions: [] }, projects: [],
		outputs: [{ path: 'Output/Health.md', tags: [], properties: { type: 'health-report' }, resolvedLinks: ['Atomics/Claim.md'], resolvedSupports: [] }],
		knowledge: [{ path: 'Atomics/Claim.md', tags: [], properties: { type: 'claim' }, resolvedLinks: [], resolvedSupports: [] }],
		outputEntries: { type: 'folder', paths: ['Output'] }
	})).inspect();
	assert.deepEqual(result.p0ClaimDebt, []);
});

void test('does not treat an Output health report as a published lifecycle entity', () => {
	const lifecycleProfile: VaultProfile = {
		...profile,
		outputEntries: { type: 'folder', paths: ['Output'] },
		outputLifecycle: { published: ['published'], reviewed: ['reviewed'] }
	};
	const result = new WorkflowInspectionService({ settings: { vaultProfile: lifecycleProfile } } as unknown as VaultOsPlugin, new MemorySource({
		security: { status: 'ready', pathSafeExclusions: [] }, projects: [], knowledge: [],
		outputs: [{ path: 'Output/Health.md', tags: [], properties: { type: 'health-report', status: 'published' }, resolvedLinks: [], resolvedSupports: [] }],
		outputEntries: { type: 'folder', paths: ['Output'] }
	})).inspect();
	assert.deepEqual(result.publishedUnreviewedOutputPaths, []);
});

void test('creates stable issue identities and snapshots without note content', () => {
	const result = service({
		security: { status: 'ready', pathSafeExclusions: [] },
		projects: [{ path: 'Projects/Alpha/Alpha.md', tags: [], properties: { status: 'completed' }, resolvedLinks: [], resolvedSupports: [] }],
		outputs: [], knowledge: []
	}).inspect();
	const inspection = service({ security: { status: 'ready', pathSafeExclusions: [] }, projects: [], outputs: [], knowledge: [] });
	const snapshot = inspection.captureSnapshot(result, '2026-07-13T00:00:00.000Z');
	assert.deepEqual(snapshot.issues, [{ id: 'completed-project:projects/alpha/alpha.md', title: '已完成但仍在 Projects：Projects/Alpha/Alpha.md' }]);
});

void test('invalidates trend comparison when the configured diagnostic rules change', () => {
	const data = {
		security: { status: 'ready' as const, pathSafeExclusions: [] },
		projects: [{ path: 'Projects/Alpha/Plan.md', tags: [], properties: { layer: 'project', status: 'completed' }, resolvedLinks: [], resolvedSupports: [] }],
		outputs: [], knowledge: []
	};
	const first = service(data);
	const result = first.inspect();
	const snapshot = first.captureSnapshot(result, '2026-07-13T00:00:00.000Z');
	const changedProfile: VaultProfile = { ...profile, projectEntries: { type: 'tag', tags: ['project'] } };
	const changed = new WorkflowInspectionService({ settings: { vaultProfile: changedProfile } } as unknown as VaultOsPlugin, new MemorySource(data));
	assert.equal(changed.compareWithSnapshot(changed.inspect(), snapshot).current[0]?.status, 'unknown');
});

void test('invalidates trend comparison after a diagnostic ruleset revision', () => {
	const inspection = service({ security: { status: 'ready', pathSafeExclusions: [] }, projects: [], outputs: [], knowledge: [] });
	const result = inspection.inspect();
	const snapshot = inspection.captureSnapshot(result, '2026-07-13T00:00:00.000Z');
	const outdatedSnapshot = { ...snapshot, ruleSetVersion: snapshot.ruleSetVersion - 1 };
	assert.equal(inspection.compareWithSnapshot(result, outdatedSnapshot).comparable, false);
});

void test('does not flag a claim when Evidence supports it', () => {
	const result = service({
		security: { status: 'ready', pathSafeExclusions: [] },
		projects: [{ path: 'Projects/Alpha/Alpha.md', tags: [], properties: { status: 'completed' }, resolvedLinks: ['Atomics/Claim.md'], resolvedSupports: [] }],
		outputs: [],
		knowledge: [
			{ path: 'Atomics/Claim.md', tags: [], properties: { type: 'claim' }, resolvedLinks: [], resolvedSupports: [] },
			{ path: 'Atomics/Evidence.md', tags: [], properties: { type: 'evidence' }, resolvedLinks: [], resolvedSupports: ['Atomics/Claim.md'] }
		]
	}).inspect();
	assert.deepEqual(result.p0ClaimDebt, []);
});

void test('surfaces non-Claim supports as a stable workflow issue', () => {
	const inspection = service({
		security: { status: 'ready', pathSafeExclusions: [] }, projects: [], outputs: [],
		knowledge: [
			{ path: 'Atomics/Question.md', tags: [], properties: { type: 'question' }, resolvedLinks: [], resolvedSupports: [] },
			{ path: 'Atomics/Evidence.md', tags: [], properties: { type: 'evidence' }, resolvedLinks: [], resolvedSupports: ['Atomics/Question.md'], declaredSupports: ['[[Atomics/Question.md]]'] }
		]
	});
	const result = inspection.inspect();
	assert.deepEqual(result.knowledgeGraph.evidenceWithNonClaimSupports, [{ evidencePath: 'Atomics/Evidence.md', targets: [{ path: 'Atomics/Question.md', kind: 'question', entityProperties: { type: 'question', cardType: undefined } }] }]);
	assert.deepEqual(inspection.getIssues(result).find(issue => issue.id === 'evidence-non-claim-supports:atomics/evidence.md'), { id: 'evidence-non-claim-supports:atomics/evidence.md', title: 'Evidence supports 指向非 Claim：Atomics/Evidence.md' });
});

void test('does not include a linked non-Claim document in active evidence debt', () => {
	const result = service({
		security: { status: 'ready', pathSafeExclusions: [] },
		projects: [{ path: 'Projects/Alpha/Alpha.md', tags: [], properties: { layer: 'project', status: 'active' }, resolvedLinks: ['Atomics/Plan.md'], resolvedSupports: [] }],
		outputs: [],
		knowledge: [{ path: 'Atomics/Plan.md', tags: [], properties: { type: 'plan' }, resolvedLinks: [], resolvedSupports: [] }]
	}).inspect();
	assert.deepEqual(result.activeClaimEvidenceDebt, []);
	assert.deepEqual(result.p0ClaimDebt, []);
});

void test('uses one snapshot issue identity when a P0 Claim is also an active Claim debt', () => {
	const result = service({
		security: { status: 'ready', pathSafeExclusions: [] },
		projects: [{ path: 'Projects/Alpha/Alpha.md', tags: [], properties: { layer: 'project', status: 'active' }, resolvedLinks: ['Atomics/Claim.md'], resolvedSupports: [] }],
		outputs: [],
		knowledge: [{ path: 'Atomics/Claim.md', tags: [], properties: { type: 'claim' }, resolvedLinks: [], resolvedSupports: [] }]
	}).inspect();
	assert.deepEqual(service({ security: { status: 'ready', pathSafeExclusions: [] }, projects: [], outputs: [], knowledge: [] }).getIssues(result), [
		{ id: 'claim-evidence-debt:atomics/claim.md', title: 'P0 Claim 缺少结构化 Evidence：Atomics/Claim.md' }
	]);
});
