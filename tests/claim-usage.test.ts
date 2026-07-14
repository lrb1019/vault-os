import assert from 'node:assert/strict';
import test from 'node:test';
import { findClaimEvidenceDebt } from '../src/domain/claim-usage.ts';

const claims = [
	{ path: 'Atomics/Claim A.md', properties: { type: 'Claim' } },
	{ path: 'Atomics/Claim B.md', properties: { card_type: 'claim' } }
];

void test('flags only claims used by eligible Project entities or Output documents', () => {
	const issues = findClaimEvidenceDebt(claims, [
		{ path: 'Projects/Client/Client.md', kind: 'project-entity', resolvedLinks: ['Atomics/Claim A.md'] },
		{ path: 'Projects/Client/Planning.md', kind: 'project-management', resolvedLinks: ['Atomics/Claim B.md'] },
		{ path: 'Output/Report.md', kind: 'output', resolvedLinks: ['Atomics/Claim B.md'] },
		{ path: 'Output/Health.md', kind: 'health-report', resolvedLinks: ['Atomics/Claim A.md'] }
	], []);

	assert.deepEqual(issues, [
		{ claimPath: 'Atomics/Claim A.md', usagePaths: ['Projects/Client/Client.md'] },
		{ claimPath: 'Atomics/Claim B.md', usagePaths: ['Output/Report.md'] }
	]);
});

void test('accepts Evidence.supports relationships and configured source exclusions', () => {
	const issues = findClaimEvidenceDebt(claims, [
		{ path: 'Projects/Client/Client.md', kind: 'project-entity', resolvedLinks: ['Atomics/Claim A.md'] },
		{ path: 'Output/Internal.md', kind: 'output', resolvedLinks: ['Atomics/Claim B.md'], tags: ['internal'] }
	], [
		{ path: 'Atomics/Evidence A.md', resolvedSupports: ['Atomics/Claim A.md'] }
	], [{ type: 'tag', tags: ['internal'] }]);

	assert.deepEqual(issues, []);
});
