import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDailyReadingReflection, parseDailyReadingReflections } from '../src/domain/daily-reflection.ts';

const markdown = `# Chapter

> [!quote] A chapter
> Small steps compound.
>
> **想法**
> Keep the next action small.
>
> ### 关联文章
> [[Atomic action]]
>
> **时间**
> 2026-07-13 09:00:00
^reflection-one

> [!note] Another chapter
> Build systems.
>
> 感想：Consistency is a decision.
>
> 时间：2026-07-12
^reflection-two`;

void test('parses Markdown-owned quotes, reflections, timestamps, links, and block ids', () => {
	const reflections = parseDailyReadingReflections(markdown, 'Books/Example.md');
	assert.equal(reflections.length, 2);
	assert.deepEqual(reflections[0], {
		filePath: 'Books/Example.md',
		bookTitle: 'Example',
		chapterTitle: 'A chapter',
		blockId: 'reflection-one',
		quote: 'Small steps compound.',
		reflection: 'Keep the next action small.',
		createdAt: '2026-07-13 09:00:00',
		linkedNotes: ['Atomic action']
	});
	assert.equal(reflections[1]?.reflection, 'Consistency is a decision.');
});

void test('selects a stable daily reflection and changes only when requested', () => {
	const reflections = parseDailyReadingReflections(markdown, 'Books/Example.md');
	assert.equal(chooseDailyReadingReflection(reflections, '2026-07-13'), chooseDailyReadingReflection(reflections, '2026-07-13'));
	assert.notEqual(
		chooseDailyReadingReflection(reflections, '2026-07-13', 0)?.blockId,
		chooseDailyReadingReflection(reflections, '2026-07-13', 1)?.blockId
	);
});
