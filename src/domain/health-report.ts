export interface MonthlyHealthReportData {
	generatedAt: Date;
	score: number;
	inboxCount: number;
	inboxOldestDays: number;
	uningestedCount: number;
	orphanCount: number;
	deadLinkCount: number;
	emptyNoteCount: number;
}

function formatDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateTime(date: Date): string {
	return `${formatDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

export function getMonthlyHealthReportFileName(date: Date): string {
	return `${formatDate(date).slice(0, 7)} 知识库巡检报告.md`;
}

export function buildMonthlyHealthReport(data: MonthlyHealthReportData): string {
	const advice = data.score >= 90
		? '- 知识库健康状况良好，保持常规记录与复盘即可。'
		: '- 建议先处理体检中数量最多的问题，再按需要调用用户配置的智能指令。';

	return `---
created: ${formatDate(data.generatedAt)}
author: "[[Jarvis]]"
type: "report"
---

# ${formatDate(data.generatedAt).slice(0, 7)} 知识库巡检报告

## 综合健康评分
- **当前得分**: **${data.score} / 100**
- **体检时间**: ${formatDateTime(data.generatedAt)}

## 诊断子项状态
- **待分类文件 (Inbox)**: ${data.inboxCount} 篇 (最久积压: ${data.inboxOldestDays} 天)
- **待入库日记 (Diary)**: ${data.uningestedCount} 篇
- **孤儿笔记 (Orphans)**: ${data.orphanCount} 篇
- **失效死链 (Dead Links)**: ${data.deadLinkCount} 处
- **空白笔记 (Empty Notes)**: ${data.emptyNoteCount} 篇

## 优化建议
${advice}
`;
}
