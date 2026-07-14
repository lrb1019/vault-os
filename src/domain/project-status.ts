export type ProjectStatus =
	| 'pending'
	| 'active'
	| 'on-hold'
	| 'blocked'
	| 'completed'
	| 'cancelled'
	| 'unknown';

export type ProjectStatusAliases = Partial<Record<Exclude<ProjectStatus, 'unknown'>, readonly string[]>>;

export interface ProjectStatusNormalizationConfig {
	aliases?: ProjectStatusAliases;
}

const canonicalAliases: Record<Exclude<ProjectStatus, 'unknown'>, readonly string[]> = {
	pending: ['pending'],
	active: ['active'],
	'on-hold': ['on-hold'],
	blocked: ['blocked'],
	completed: ['completed'],
	cancelled: ['cancelled', 'canceled']
};

export function normalizeProjectStatusText(value: string): string {
	return value
		.normalize('NFKC')
		.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, ' ')
		.replace(/^[\s\-–—:：/|•·]+|[\s\-–—:：/|•·]+$/gu, '')
		.replace(/\s+/gu, ' ')
		.toLocaleLowerCase();
}

/** Converts a display-oriented project status to the stable domain vocabulary. */
export function normalizeProjectStatus(
	value: unknown,
	config: ProjectStatusNormalizationConfig = {}
): ProjectStatus {
	if (typeof value !== 'string') return 'unknown';
	const normalized = normalizeProjectStatusText(value);
	if (normalized === '') return 'unknown';

	for (const status of Object.keys(canonicalAliases) as Array<Exclude<ProjectStatus, 'unknown'>>) {
		const aliases = [...canonicalAliases[status], ...(config.aliases?.[status] || [])];
		if (aliases.some(alias => normalizeProjectStatusText(alias) === normalized)) return status;
	}

	return 'unknown';
}
