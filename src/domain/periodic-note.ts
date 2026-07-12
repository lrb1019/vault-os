export type PeriodicCycle = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface PeriodicNoteTarget {
	folderPath: string;
	fileName: string;
	filePath: string;
}

export interface PeriodicPathProvider {
	id: string;
	resolve(date: Date, cycle: PeriodicCycle): PeriodicNoteTarget;
}

export interface ManualPeriodicConfig {
	rootFolder: string;
	patterns: Record<PeriodicCycle, string>;
	templates: Record<PeriodicCycle, string>;
}

export function createDefaultManualPeriodicConfig(rootFolder: string): ManualPeriodicConfig {
	return {
		rootFolder,
		patterns: {
			day: 'YYYY-MM-DD',
			week: 'GGGG-[W]WW',
			month: 'YYYY-MM',
			quarter: 'YYYY-[Q]Q',
			year: 'YYYY'
		},
		templates: { day: '', week: '', month: '', quarter: '', year: '' }
	};
}

export type PatternFormatter = (pattern: string) => string;

function normalizeFolderPath(path: string): string {
	return path.trim().replace(/^\/+|\/+$/g, '');
}

function splitPeriodicPattern(pattern: string): { folderPattern: string; filePattern: string } {
	let insideBrackets = false;
	let lastSlashIndex = -1;
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index];
		if (char === '[') insideBrackets = true;
		else if (char === ']') insideBrackets = false;
		else if (char === '/' && !insideBrackets) lastSlashIndex = index;
	}

	return lastSlashIndex === -1
		? { folderPattern: '', filePattern: pattern }
		: { folderPattern: pattern.slice(0, lastSlashIndex), filePattern: pattern.slice(lastSlashIndex + 1) };
}

export function resolvePeriodicNoteTarget(rootFolder: string, pattern: string, format: PatternFormatter): PeriodicNoteTarget {
	const { folderPattern, filePattern } = splitPeriodicPattern(pattern);
	const formattedFolder = folderPattern ? format(folderPattern) : '';
	const formattedName = format(filePattern).trim();
	const folderPath = [normalizeFolderPath(rootFolder), normalizeFolderPath(formattedFolder)].filter(Boolean).join('/');
	const fileName = formattedName.endsWith('.md') ? formattedName : `${formattedName}.md`;

	return {
		folderPath: folderPath || '/',
		fileName,
		filePath: folderPath ? `${folderPath}/${fileName}` : fileName
	};
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

function getIsoWeek(date: Date): { year: number; week: number } {
	const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const day = utcDate.getUTCDay() || 7;
	utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
	const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	return { year: utcDate.getUTCFullYear(), week };
}

export function formatManualPeriodicName(date: Date, cycle: PeriodicCycle): string {
	const year = date.getFullYear();
	if (cycle === 'day') return `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	if (cycle === 'week') {
		const isoWeek = getIsoWeek(date);
		return `${isoWeek.year}-W${pad(isoWeek.week)}`;
	}
	if (cycle === 'month') return `${year}-${pad(date.getMonth() + 1)}`;
	if (cycle === 'quarter') return `${year}-Q${Math.floor(date.getMonth() / 3) + 1}`;
	return String(year);
}

export class ManualPeriodicPathProvider implements PeriodicPathProvider {
	readonly id = 'manual';
	private readonly rootFolder: string;

	constructor(rootFolder: string) {
		this.rootFolder = rootFolder;
	}

	resolve(date: Date, cycle: PeriodicCycle): PeriodicNoteTarget {
		return resolvePeriodicNoteTarget(this.rootFolder, formatManualPeriodicName(date, cycle), pattern => pattern);
	}
}

export function buildDefaultPeriodicNoteContent(date: Date, baseName: string): string {
	const created = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	return `---
created: ${created}
author: "[[Jarvis]]"
ingested: false
---

# ${baseName}
`;
}
