import assert from 'node:assert/strict';
import test from 'node:test';
import { renderActionTemplate } from '../src/domain/action-template.ts';

void test('renders only known action variables and preserves unrelated template text', () => {
	const result = renderActionTemplate(
		'{{daily_path}} | {{inbox_path}} | {{input}} | {{unknown}}',
		{
			dailyPath: 'Journal',
			inboxPath: 'Capture',
			atomicsPath: 'Knowledge',
			archivePath: 'Archive',
			outputPath: 'Output',
			input: 'topic'
		}
	);
	assert.equal(result, 'Journal | Capture | topic | {{unknown}}');
});

void test('uses an empty string for an omitted optional action input', () => {
	const result = renderActionTemplate('{{input}}', {
		dailyPath: '',
		inboxPath: '',
		atomicsPath: '',
		archivePath: '',
		outputPath: ''
	});
	assert.equal(result, '');
});
