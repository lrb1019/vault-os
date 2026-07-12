import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverInboxScopeCandidates } from '../src/domain/vault-profile-discovery.ts';
import { createLegacyVaultProfile, matchesScopeRule, resolveScope, unionScopeRules, type VaultFileDescriptor } from '../src/domain/vault-profile.ts';

const dailyFile: VaultFileDescriptor = { path: 'Journal/2026-07-12.md', tags: ['daily'], properties: { type: 'daily', visibility: 'personal' } };
const atomicFile: VaultFileDescriptor = { path: 'Knowledge/Atomic note.md', tags: ['knowledge', '#evergreen'], properties: { type: 'atomic', topics: ['ai', 'writing'] } };
const templateFile: VaultFileDescriptor = { path: 'Templates/Daily.md', tags: ['template'], properties: { type: 'daily' } };
const inboxFile: VaultFileDescriptor = { path: 'Inbox/Capture.md', tags: ['inbox'], properties: { status: 'inbox' } };
const files: VaultFileDescriptor[] = [dailyFile, atomicFile, templateFile, inboxFile];

void test('matches folder rules without matching a similarly named sibling folder', () => {
	assert.equal(matchesScopeRule(dailyFile, { type: 'folder', paths: ['Journal'] }), true);
	assert.equal(matchesScopeRule(dailyFile, { type: 'folder', paths: ['Jour'] }), false);
	assert.equal(matchesScopeRule(atomicFile, { type: 'folder', paths: ['journal'] }), false);
});

void test('matches tags and scalar or array frontmatter values', () => {
	assert.equal(matchesScopeRule(atomicFile, { type: 'tag', tags: ['evergreen'] }), true);
	assert.equal(matchesScopeRule(atomicFile, { type: 'property', key: 'topics', values: ['writing'] }), true);
	assert.equal(matchesScopeRule(dailyFile, { type: 'property', key: 'visibility', values: ['PERSONAL'] }), true);
	assert.equal(matchesScopeRule(inboxFile, { type: 'property', key: 'status', values: ['active'] }), false);
});

void test('resolves compound rules and exclusions without hard-coded vault folders', () => {
	const knowledgeScope = {
		type: 'compound' as const,
		operator: 'or' as const,
		rules: [
			{ type: 'tag' as const, tags: ['knowledge'] },
			{ type: 'property' as const, key: 'type', values: ['atomic'] }
		]
	};
	const selected = resolveScope(files, knowledgeScope, [{ type: 'tag', tags: ['template'] }]);

	assert.deepEqual(selected.map(file => file.path), ['Knowledge/Atomic note.md']);
});

void test('unions configured role scopes without falling back to the whole vault', () => {
	const scope = unionScopeRules([
		{ type: 'folder', paths: ['Journal'] },
		{ type: 'tag', tags: ['knowledge'] },
		undefined
	]);
	assert.ok(scope);
	assert.deepEqual(resolveScope(files, scope).map(file => file.path), [
		'Journal/2026-07-12.md',
		'Knowledge/Atomic note.md'
	]);
	assert.equal(unionScopeRules([]), undefined);
});

void test('uses a non-recursive compatibility rule for the existing Inbox folder setting', () => {
	const profile = createLegacyVaultProfile({
		dailyNoteFolder: 'Journal',
		inboxFolder: 'Inbox',
		atomicsFolder: 'Knowledge',
		outputFolder: 'Output'
	});
	const inbox = profile.inbox;
	assert.ok(inbox);

	const selected = resolveScope(
		[
			{ path: 'Inbox/Capture.md' },
			{ path: 'Inbox/Archive/Older.md' },
			{ path: 'Other/Inbox.md' }
		],
		inbox
	);

	assert.deepEqual(selected.map(file => file.path), ['Inbox/Capture.md']);
});

void test('keeps historical template and book exclusions inside the compatibility profile', () => {
	const profile = createLegacyVaultProfile({
		dailyNoteFolder: 'Journal',
		inboxFolder: 'Inbox',
		atomicsFolder: 'Knowledge',
		outputFolder: 'Output'
	});
	const selected = resolveScope([
		{ path: '00 Templates/Daily.md' },
		{ path: '09Books/Reference.md' },
		{ path: 'Knowledge/Note.md' }
	], { type: 'all-markdown' }, profile.exclusions);

	assert.deepEqual(selected.map(file => file.path), ['Knowledge/Note.md']);
});

void test('discovers inbox candidates from names, tags, and properties without selecting one automatically', () => {
	const candidates = discoverInboxScopeCandidates([
		{ path: 'Capture/Voice note.md', tags: ['inbox'], properties: { status: 'inbox' } },
		{ path: 'Capture/Web clip.md', tags: ['inbox'], properties: { status: 'inbox' } },
		{ path: 'Knowledge/Finished.md', tags: ['knowledge'], properties: { status: 'done' } }
	]);

	assert.deepEqual(candidates.map(candidate => candidate.label), [
		'属性：status = inbox',
		'文件夹：Capture',
		'标签：#inbox'
	]);
	assert.equal(candidates.every(candidate => candidate.matchedCount === 2), true);
});
