export interface OutputLifecycleConfig {
	published: readonly string[];
	reviewed: readonly string[];
}

function normalize(value: string): string {
	return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

export function isOutputLifecycleConfigured(config: OutputLifecycleConfig | undefined): config is OutputLifecycleConfig {
	return Boolean(config && config.published.some(Boolean) && config.reviewed.some(Boolean));
}

/**
 * An Output is actionable only when its own lifecycle status explicitly maps
 * to "published". Unknown and reviewed states intentionally remain silent.
 */
export function isPublishedAwaitingReview(status: unknown, config: OutputLifecycleConfig | undefined): boolean {
	if (!isOutputLifecycleConfigured(config) || typeof status !== 'string') return false;
	const normalized = normalize(status);
	const published = config.published.some(value => normalize(value) === normalized);
	const reviewed = config.reviewed.some(value => normalize(value) === normalized);
	return published && !reviewed;
}
