import assert from 'node:assert/strict';
import test from 'node:test';
import { compareWorkflowInspectionSnapshot, isWorkflowInspectionSnapshot } from '../src/domain/workflow-inspection-snapshot.ts';

void test('uses unknown for the first baseline and after a rule change', () => {
	const withoutBaseline = compareWorkflowInspectionSnapshot([{ id: 'a', title: 'A' }], undefined, 1);
	const changedRules = compareWorkflowInspectionSnapshot([{ id: 'a', title: 'A' }], { ruleSetVersion: 1, capturedAt: 'x', issues: [{ id: 'a', title: 'A' }] }, 2);
	assert.equal(withoutBaseline.comparable, false);
	assert.deepEqual(withoutBaseline.current[0]?.status, 'unknown');
	assert.equal(changedRules.comparable, false);
	assert.deepEqual(changedRules.current[0]?.status, 'unknown');
});

void test('separates new persistent and resolved issues', () => {
	const diff = compareWorkflowInspectionSnapshot([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], {
		ruleSetVersion: 1, capturedAt: 'x', issues: [{ id: 'a', title: 'A' }, { id: 'c', title: 'C' }]
	}, 1);
	assert.equal(diff.comparable, true);
	assert.deepEqual(diff.current.map(issue => issue.status), ['persistent', 'new']);
	assert.deepEqual(diff.resolved, [{ id: 'c', title: 'C', status: 'resolved' }]);
});

void test('rejects malformed persisted snapshots', () => {
	assert.equal(isWorkflowInspectionSnapshot({ ruleSetVersion: 1, capturedAt: 'x', issues: [{ id: 'a', title: 'A' }] }), true);
	assert.equal(isWorkflowInspectionSnapshot({ ruleSetVersion: '1', capturedAt: 'x', issues: [] }), false);
	assert.equal(isWorkflowInspectionSnapshot({ ruleSetVersion: 1, capturedAt: 'x', issues: [{ id: 'a' }] }), false);
});
