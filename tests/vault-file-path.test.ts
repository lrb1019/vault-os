import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArchiveTargetPath } from '../src/domain/vault-file-path.ts';

void test('builds a normalized archive target without relying on a vault-specific folder name', () => {
	assert.equal(buildArchiveTargetPath('/Archive/2026/', 'Capture.md'), 'Archive/2026/Capture.md');
});

void test('rejects empty, traversal, and multi-path archive inputs', () => {
	assert.throws(() => buildArchiveTargetPath('', 'Capture.md'), /未配置/);
	assert.throws(() => buildArchiveTargetPath('Archive/../Other', 'Capture.md'), /无效/);
	assert.throws(() => buildArchiveTargetPath('Archive', '../Capture.md'), /无效/);
});
