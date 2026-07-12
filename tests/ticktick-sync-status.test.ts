import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteSyncStatus } from '../src/domain/ticktick-sync-status.ts';

void test('reports remote success and durable cache persistence separately', () => {
	const status = createRemoteSyncStatus(123, { ok: true });
	assert.deepEqual(status, {
		state: 'success',
		lastSyncedAt: 123,
		errorMessage: null,
		remoteState: 'success',
		cacheState: 'persisted'
	});
});

void test('does not present a cache write failure as a failed remote sync', () => {
	const status = createRemoteSyncStatus(123, { ok: false });
	assert.equal(status.state, 'success');
	assert.equal(status.remoteState, 'success');
	assert.equal(status.cacheState, 'write-error');
	assert.match(status.errorMessage || '', /本地缓存写入失败/);
});
