export type ThinkingStage = 'developing' | 'settled' | 'unclassified';

export interface ThinkingMapNote {
	path: string;
	title: string;
	stage: ThinkingStage;
	updatedAt: number;
	ageDays: number;
	hasUnresolved: boolean;
}

export interface SynthesisMapNote {
	path: string;
	title: string;
	updatedAt: number;
	ageDays: number;
	linkedThinkingCount: number;
}

export function normalizeThinkingStage(value: unknown): ThinkingStage {
	if (typeof value !== 'string') return 'unclassified';
	const normalized = value.trim().replace(/^['"]|['"]$/g, '').toLocaleLowerCase();
	if (normalized === 'developing') return 'developing';
	if (normalized === 'settled') return 'settled';
	return 'unclassified';
}

export function hasUnresolvedThinking(content: string): boolean {
	const section = content.match(/^##\s+尚未解决\s*$([\s\S]*?)(?=^#{1,2}\s+|(?![\s\S]))/mu)?.[1] || '';
	const meaningful = section
		.replace(/%%[\s\S]*?%%/gu, '')
		.replace(/^\s*[-*+]\s*$/gmu, '')
		.trim();
	return meaningful !== '';
}

export function calculateAgeDays(updatedAt: number, now: number): number {
	if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) return 0;
	return Math.max(0, Math.floor((now - updatedAt) / 86_400_000));
}
