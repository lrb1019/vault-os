import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSupportsReferences } from '../src/domain/supports-reference.ts';

void test('parses plain, aliased, path, heading, and block wiki links', () => {
	const result = parseSupportsReferences([
		'[[Claim]]',
		'[[Folder/Claim|显示名]]',
		'[[Claim#章节]]',
		'[[Claim^block-id]]'
	]);
	assert.deepEqual(result.references.map(reference => reference.linkpath), ['Claim', 'Folder/Claim', 'Claim', 'Claim']);
	assert.deepEqual(result.invalidValues, []);
});

void test('reports malformed or non-string supports without treating them as evidence', () => {
	assert.deepEqual(parseSupportsReferences('not a link').invalidValues, ['not a link']);
	assert.deepEqual(parseSupportsReferences(['[[Claim]]', 1]).invalidValues, ['supports 必须是字符串或字符串数组']);
});

void test('treats an empty supports array as an unlinked Evidence instead of malformed data', () => {
	const result = parseSupportsReferences([]);
	assert.deepEqual(result.references, []);
	assert.deepEqual(result.invalidValues, []);
});
