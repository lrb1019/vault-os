import assert from 'node:assert/strict';
import test from 'node:test';
import { executeSelectedFileOperation } from '../src/domain/batch-file-operation.ts';

const candidates = [
	{ path: 'notes/empty-a.md' },
	{ path: 'notes/empty-b.md' },
	{ path: 'notes/empty-c.md' }
];

void test('only executes candidates explicitly selected by the user', async () => {
	const executed: string[] = [];
	const result = await executeSelectedFileOperation(
		candidates,
		['notes/empty-a.md', 'notes/empty-c.md', 'missing.md'],
		async candidate => {
			executed.push(candidate.path);
		}
	);

	assert.deepEqual(executed, ['notes/empty-a.md', 'notes/empty-c.md']);
	assert.equal(result.requestedCount, 2);
	assert.equal(result.succeededCount, 2);
	assert.equal(result.failedCount, 0);
});

void test('records a failed file and continues with the remaining selected files', async () => {
	const executed: string[] = [];
	const result = await executeSelectedFileOperation(
		candidates,
		['notes/empty-a.md', 'notes/empty-b.md', 'notes/empty-c.md'],
		async candidate => {
			executed.push(candidate.path);
			if (candidate.path === 'notes/empty-b.md') {
				throw new Error('文件已被移动');
			}
		}
	);

	assert.deepEqual(executed, candidates.map(candidate => candidate.path));
	assert.equal(result.requestedCount, 3);
	assert.equal(result.succeededCount, 2);
	assert.equal(result.failedCount, 1);
	assert.deepEqual(result.items[1], {
		path: 'notes/empty-b.md',
		status: 'failed',
		errorMessage: '文件已被移动'
	});
});

void test('does not execute when no candidate is selected', async () => {
	let executeCount = 0;
	const result = await executeSelectedFileOperation(candidates, [], async () => {
		executeCount++;
	});

	assert.equal(executeCount, 0);
	assert.deepEqual(result, {
		requestedCount: 0,
		succeededCount: 0,
		failedCount: 0,
		items: []
	});
});
