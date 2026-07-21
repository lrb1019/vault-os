import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAgeDays, hasUnresolvedThinking, normalizeThinkingStage } from '../src/domain/thinking-map.ts';

void test('normalizes only the two declared Thinking stages', () => {
	assert.equal(normalizeThinkingStage('developing'), 'developing');
	assert.equal(normalizeThinkingStage('"settled"'), 'settled');
	assert.equal(normalizeThinkingStage('draft'), 'unclassified');
	assert.equal(normalizeThinkingStage(undefined), 'unclassified');
});

void test('ignores template comments in the unresolved section', () => {
	assert.equal(hasUnresolvedThinking('## 尚未解决\n%% 提示文字 %%\n\n## 修正记录'), false);
	assert.equal(hasUnresolvedThinking('## 尚未解决\n- 我还不确定边界在哪里\n\n## 修正记录'), true);
});

void test('calculates non-negative whole-day age', () => {
	const now = Date.UTC(2026, 6, 21);
	assert.equal(calculateAgeDays(now - 3.8 * 86_400_000, now), 3);
	assert.equal(calculateAgeDays(now + 86_400_000, now), 0);
});
