import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProjectStatus, normalizeProjectStatusText } from '../src/domain/project-status.ts';

void test('normalizes display emoji and whitespace before status mapping', () => {
	assert.equal(normalizeProjectStatusText('  🔵\tCompleted  '), 'completed');
	assert.equal(normalizeProjectStatus('🔵\tCompleted'), 'completed');
});

void test('uses configured compatibility aliases and leaves unknown values unknown', () => {
	const config = { aliases: { active: ['进行中'], 'on-hold': ['暂停'], completed: ['已完成'] } };
	assert.equal(normalizeProjectStatus('进行中', config), 'active');
	assert.equal(normalizeProjectStatus('⏸ 暂停', config), 'on-hold');
	assert.equal(normalizeProjectStatus('已完成', config), 'completed');
	assert.equal(normalizeProjectStatus('条件成立才值得', config), 'unknown');
	assert.equal(normalizeProjectStatus(['completed'], config), 'unknown');
});
