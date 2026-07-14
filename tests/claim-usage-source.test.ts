import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyClaimUsageSource } from '../src/domain/claim-usage-source.ts';

void test('excludes system and management documents from Output usage sources', () => {
	assert.equal(classifyClaimUsageSource({ path: 'Output/Index.md', properties: { type: 'index' } }), 'index');
	assert.equal(classifyClaimUsageSource({ path: 'Output/Health.md', properties: { report_type: '体检报告' } }), 'health-report');
	assert.equal(classifyClaimUsageSource({ path: 'Output/Audit.md', properties: { layer: 'audit' } }), 'audit-document');
	assert.equal(classifyClaimUsageSource({ path: 'Output/Project Notes.md', properties: { category: '项目管理' } }), 'project-management');
	assert.equal(classifyClaimUsageSource({ path: 'Output/本月体检报告.md' }), 'health-report');
	assert.equal(classifyClaimUsageSource({ path: 'Output/证据债务优先级-2026-07-13.md' }), 'evidence-debt-report');
});

void test('keeps ordinary configured Output documents as true usage sources', () => {
	assert.equal(classifyClaimUsageSource({ path: 'Output/Essay.md', properties: { type: 'article' } }), 'output');
});
