import assert from 'node:assert/strict';
import test from 'node:test';
import { ManualPeriodicPathProvider, buildDefaultPeriodicNoteContent, createDefaultManualPeriodicConfig, formatManualPeriodicName, resolvePeriodicNoteTarget } from '../src/domain/periodic-note.ts';

void test('generates distinct manual targets for every periodic cycle', () => {
	const date = new Date(2026, 6, 12);
	assert.deepEqual([
		formatManualPeriodicName(date, 'day'),
		formatManualPeriodicName(date, 'week'),
		formatManualPeriodicName(date, 'month'),
		formatManualPeriodicName(date, 'quarter'),
		formatManualPeriodicName(date, 'year')
	], ['2026-07-12', '2026-W28', '2026-07', '2026-Q3', '2026']);
});

void test('keeps folder patterns and bracketed literal slashes separate from file names', () => {
	const target = resolvePeriodicNoteTarget('Journal', 'YYYY/MM/[week/day]/GGGG-[W]WW', pattern => ({
		'YYYY/MM/[week/day]': '2026/07/week/day',
		'GGGG-[W]WW': '2026-W28'
	})[pattern] || pattern);
	assert.deepEqual(target, {
		folderPath: 'Journal/2026/07/week/day',
		fileName: '2026-W28.md',
		filePath: 'Journal/2026/07/week/day/2026-W28.md'
	});
});

void test('manual provider resolves a stable root folder for every target', () => {
	const provider = new ManualPeriodicPathProvider('Journal');
	const target = provider.resolve(new Date(2026, 6, 12), 'quarter');
	assert.equal(target.filePath, 'Journal/2026-Q3.md');
});

void test('creates configurable manual defaults without borrowing a vault-specific folder', () => {
	const config = createDefaultManualPeriodicConfig('Journal');
	assert.equal(config.rootFolder, 'Journal');
	assert.equal(config.patterns.week, 'GGGG-[W]WW');
	assert.equal(config.templates.year, '');
});

void test('builds a default periodic note with stable metadata and a cycle title', () => {
	const content = buildDefaultPeriodicNoteContent(new Date(2026, 6, 12), '2026-W28');
	assert.match(content, /created: 2026-07-12/);
	assert.match(content, /author: "\[\[Jarvis\]\]"/);
	assert.match(content, /# 2026-W28/);
});
