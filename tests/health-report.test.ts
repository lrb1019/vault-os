import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonthlyHealthReport, getMonthlyHealthReportFileName } from '../src/domain/health-report.ts';

void test('builds a deterministic monthly report name and content from scan data', () => {
	const generatedAt = new Date(2026, 6, 12, 9, 30, 0);
	assert.equal(getMonthlyHealthReportFileName(generatedAt), '2026-07 知识库巡检报告.md');
	const report = buildMonthlyHealthReport({
		generatedAt,
		score: 88,
		inboxCount: 2,
		inboxOldestDays: 3,
		uningestedCount: 1,
		orphanCount: 4,
		deadLinkCount: 5,
		emptyNoteCount: 6,
		ingestedCount: 7,
		fixedLinkCount: 8,
		cleanedEmptyCount: 9
	});

	assert.match(report, /# 2026-07 知识库巡检报告/);
	assert.match(report, /\*\*当前得分\*\*: \*\*88 \/ 100\*\*/);
	assert.match(report, /\*\*已清理空白笔记 \(Cleaned Empty\)\*\*: 9 篇/);
});
