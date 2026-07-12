import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowActionOnHome } from '../src/domain/action-visibility.ts';

void test('shows only enabled direct actions that are permitted on the home dashboard', () => {
	assert.equal(shouldShowActionOnHome({ requireInput: false }), true);
	assert.equal(shouldShowActionOnHome({ requireInput: false, showOnHome: true }), true);
	assert.equal(shouldShowActionOnHome({ requireInput: false, showOnHome: false }), false);
	assert.equal(shouldShowActionOnHome({ requireInput: true, showOnHome: true }), false);
	assert.equal(shouldShowActionOnHome({ requireInput: false, enabled: false }), false);
});
