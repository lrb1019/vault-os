import assert from 'node:assert/strict';
import test from 'node:test';
import { identifyProjectEntity, isProjectEntity } from '../src/domain/project-entity.ts';

void test('recognizes layer project before any project status is considered', () => {
	assert.equal(isProjectEntity({ path: 'Workspace/Notes/Brief.md', properties: { layer: 'project', status: 'active' } }), true);
	assert.equal(isProjectEntity({ path: 'Projects/Client/Meeting.md', properties: { status: 'completed' } }), false);
	assert.deepEqual(
		identifyProjectEntity({ path: 'Workspace/Notes/Brief.md', properties: { layer: 'project', status: '🔵 Completed' } }),
		{ path: 'Workspace/Notes/Brief.md', status: 'completed' }
	);
	assert.equal(
		identifyProjectEntity({ path: 'Projects/Client/Meeting.md', properties: { status: 'completed' } }),
		undefined
	);
});

void test('recognizes a configured project entry rule without treating the scope as an entity rule', () => {
	const config = { entryRule: { type: 'tag' as const, tags: ['project-entry'] } };
	assert.equal(isProjectEntity({ path: 'Projects/Client/Overview.md', tags: ['project-entry'] }, config), true);
	assert.equal(isProjectEntity({ path: 'Projects/Client/Delivery.md', tags: ['delivery'] }, config), false);
});

void test('keeps the folder-name homepage as a compatibility fallback', () => {
	assert.equal(isProjectEntity({ path: 'Projects/Client/Client.md' }), true);
	assert.equal(isProjectEntity({ path: 'Projects/Client/Planning.md' }), false);
	assert.equal(isProjectEntity({ path: 'Client.md' }), false);
});
