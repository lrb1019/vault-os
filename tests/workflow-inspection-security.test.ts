import assert from 'node:assert/strict';
import test from 'node:test';
import { assessWorkflowInspectionSecurity, isExcludedBeforeMetadataRead } from '../src/domain/workflow-inspection-security.ts';

void test('fails closed when no path-level global exclusion exists', () => {
	assert.deepEqual(assessWorkflowInspectionSecurity([]).status, 'blocked');
	assert.deepEqual(assessWorkflowInspectionSecurity([{ type: 'tag', tags: ['private'] }]).status, 'blocked');
	assert.deepEqual(assessWorkflowInspectionSecurity([{ type: 'property', key: 'private', values: ['true'] }]).status, 'blocked');
});

void test('allows only confirmed folder exclusions to protect files before metadata access', () => {
	const state = assessWorkflowInspectionSecurity([{ type: 'folder', paths: ['Sensitive/Secrets'] }]);
	assert.equal(state.status, 'ready');
	assert.equal(isExcludedBeforeMetadataRead({ path: 'Sensitive/Secrets/Key.md' }, state.pathSafeExclusions), true);
	assert.equal(isExcludedBeforeMetadataRead({ path: 'Knowledge/Claim.md' }, state.pathSafeExclusions), false);
});

void test('supports compound path-only exclusions without treating mixed rules as safe', () => {
	assert.equal(assessWorkflowInspectionSecurity([{
		type: 'compound', operator: 'or', rules: [
			{ type: 'folder', paths: ['Private'] },
			{ type: 'folder', paths: ['Secrets'] }
		]
	}]).status, 'ready');
	assert.equal(assessWorkflowInspectionSecurity([{
		type: 'compound', operator: 'or', rules: [
			{ type: 'folder', paths: ['Private'] },
			{ type: 'tag', tags: ['private'] }
		]
	}]).status, 'blocked');
});

void test('stops when any configured global exclusion cannot be applied before metadata reads', () => {
	assert.equal(assessWorkflowInspectionSecurity([
		{ type: 'folder', paths: ['Secrets'] },
		{ type: 'tag', tags: ['private'] }
	]).status, 'blocked');
});
