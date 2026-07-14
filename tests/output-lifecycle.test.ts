import assert from 'node:assert/strict';
import test from 'node:test';
import { isOutputLifecycleConfigured, isPublishedAwaitingReview } from '../src/domain/output-lifecycle.ts';

void test('requires both published and reviewed mappings before judging Output lifecycle', () => {
	assert.equal(isOutputLifecycleConfigured({ published: ['published'], reviewed: [] }), false);
	assert.equal(isPublishedAwaitingReview('published', { published: ['published'], reviewed: [] }), false);
});

void test('flags only explicitly published Output statuses', () => {
	const lifecycle = { published: ['Published', '已发布'], reviewed: ['Reviewed', '已复盘'] };
	assert.equal(isPublishedAwaitingReview('已发布', lifecycle), true);
	assert.equal(isPublishedAwaitingReview('reviewed', lifecycle), false);
	assert.equal(isPublishedAwaitingReview('draft', lifecycle), false);
});
