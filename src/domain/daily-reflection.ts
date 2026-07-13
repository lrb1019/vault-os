export interface DailyReadingReflection {
	filePath: string;
	bookTitle: string;
	chapterTitle: string;
	blockId: string;
	quote: string;
	reflection: string;
	createdAt: string;
	linkedNotes: string[];
}

function stripBlockquotePrefix(line: string): string {
	return line.replace(/^(?:>\s*)+/, '').trim();
}

function cleanBookTitle(filePath: string): string {
	const filename = filePath.split('/').pop() || filePath;
	return filename.replace(/\.md$/i, '').trim();
}

function readBlock(lines: readonly string[], filePath: string, blockIndex: number, blockId: string): DailyReadingReflection | null {
	let startIndex = blockIndex;
	while (startIndex > 0 && !/^>\s*\[!(?:quote|note)\]/i.test(lines[startIndex] || '')) {
		startIndex--;
	}
	const callout = lines[startIndex] || '';
	const calloutMatch = callout.match(/^>\s*\[!(?:quote|note)\]\s*(.*)$/i);
	if (!calloutMatch) return null;

	const quoteLines: string[] = [];
	const reflectionLines: string[] = [];
	const linkedNotes: string[] = [];
	let createdAt = '';
	let awaitingTimestamp = false;
	let mode: 'quote' | 'reflection' | 'metadata' = 'quote';

	for (let index = startIndex + 1; index < blockIndex; index++) {
		const line = stripBlockquotePrefix(lines[index] || '');
		const thoughtMatch = line.match(/^(?:\*\*)?(?:想法|笔记|感想)(?:\s+\d+)?(?:\*\*)?\s*[:：]?\s*(.*)$/);
		const timeMatch = line.match(/^(?:\*\*)?时间(?:\*\*)?\s*[:：]?\s*(.*)$/);

		if (/^#{3}\s+关联文章/.test(line)) {
			mode = 'metadata';
			continue;
		}
		if (timeMatch) {
				createdAt = (timeMatch[1] || '').trim();
			awaitingTimestamp = createdAt === '';
			mode = 'metadata';
			continue;
		}
		if (awaitingTimestamp && line) {
			createdAt = line;
			awaitingTimestamp = false;
			continue;
		}
		if (/^created:\s*/i.test(line)) {
			createdAt = line.replace(/^created:\s*/i, '').trim() || createdAt;
			continue;
		}
		if (thoughtMatch) {
			mode = 'reflection';
			if (thoughtMatch[1]) reflectionLines.push(thoughtMatch[1]);
			continue;
		}

			const links = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => (match[1] || '').trim()).filter(Boolean);
		linkedNotes.push(...links);
		if (!line) continue;
		if (mode === 'quote') quoteLines.push(line);
		if (mode === 'reflection') reflectionLines.push(line);
	}

	const reflection = reflectionLines.join('\n').trim();
	if (!reflection) return null;
	return {
		filePath,
		bookTitle: cleanBookTitle(filePath),
		chapterTitle: (calloutMatch[1] || '').trim() || '阅读摘录',
		blockId,
		quote: quoteLines.join('\n').trim(),
		reflection,
		createdAt,
		linkedNotes: [...new Set(linkedNotes)]
	};
}

/** Extracts Markdown-owned reading reflections without depending on a reader plugin's private state. */
export function parseDailyReadingReflections(content: string, filePath: string): DailyReadingReflection[] {
	const lines = content.split(/\r?\n/);
	const reflections: DailyReadingReflection[] = [];
	for (let index = 0; index < lines.length; index++) {
		const blockId = lines[index]?.trim().match(/^\^([A-Za-z0-9_-]+)$/)?.[1];
		if (!blockId) continue;
		const reflection = readBlock(lines, filePath, index, blockId);
		if (reflection) reflections.push(reflection);
	}
	return reflections;
}

function stableHash(value: string): number {
	let hash = 2166136261;
	for (const character of value) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/** Picks one deterministic item for a calendar day, so reloading the dashboard does not reshuffle it. */
export function chooseDailyReadingReflection(
	reflections: readonly DailyReadingReflection[],
	dayKey: string,
	offset = 0
): DailyReadingReflection | undefined {
	if (reflections.length === 0) return undefined;
	const sorted = [...reflections].sort((left, right) => `${left.filePath}:${left.blockId}`.localeCompare(`${right.filePath}:${right.blockId}`));
	return sorted[(stableHash(dayKey) + offset) % sorted.length];
}
