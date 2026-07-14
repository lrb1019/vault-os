import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSmartActionCategories, requiresSmartActionInput, resolveSmartActionCategoryId } from '../src/domain/smart-action.ts';

void test('provides editable default categories with a permanent unclassified fallback', () => {
	const categories = normalizeSmartActionCategories(undefined);
	assert.equal(categories.some(category => category.id === 'workflow'), true);
	assert.equal(categories.some(category => category.id === 'unclassified'), true);
});

void test('keeps valid custom categories and moves missing category ids to unclassified', () => {
	const categories = normalizeSmartActionCategories([{ id: 'journal', label: '日记', icon: 'notebook-pen' }]);
	assert.deepEqual(categories.map(category => category.id), ['journal', 'unclassified']);
	assert.equal(resolveSmartActionCategoryId({ id: 'custom', categoryId: 'journal' }, categories), 'journal');
	assert.equal(resolveSmartActionCategoryId({ id: 'custom', categoryId: 'deleted-category' }, categories), 'unclassified');
});

void test('migrates historical built-in actions without moving custom actions out of unclassified', () => {
	const categories = normalizeSmartActionCategories(undefined);
	assert.equal(resolveSmartActionCategoryId({ id: 'action-1' }, categories), 'workflow');
	assert.equal(resolveSmartActionCategoryId({ id: 'custom-action' }, categories), 'unclassified');
});

void test('uses the explicit input setting to decide whether a command opens an input dialog', () => {
	assert.equal(requiresSmartActionInput({ requireInput: true }), true);
	assert.equal(requiresSmartActionInput({ requireInput: false }), false);
});
