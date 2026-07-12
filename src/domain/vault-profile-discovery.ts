import type { ScopeRule, VaultFileDescriptor } from './vault-profile';

export interface ScopeRuleCandidate {
	rule: ScopeRule;
	label: string;
	evidence: string;
	matchedCount: number;
}

const inboxTerms = new Set(['inbox', 'capture', 'captures', '收件箱', '待处理']);

function normalize(value: string): string {
	return value.trim().replace(/^#/, '').toLocaleLowerCase();
}

function parentDirectory(path: string): string {
	const normalizedPath = path.replace(/\\/g, '/');
	const separatorIndex = normalizedPath.lastIndexOf('/');
	return separatorIndex === -1 ? '' : normalizedPath.slice(0, separatorIndex);
}

function finalDirectory(path: string): string {
	const parent = parentDirectory(path);
	const separatorIndex = parent.lastIndexOf('/');
	return normalize(separatorIndex === -1 ? parent : parent.slice(separatorIndex + 1));
}

function findMatchingInboxTerm(value: unknown): string | null {
	if (Array.isArray(value)) {
		for (const item of value) {
			const normalized = normalize(String(item));
			if (inboxTerms.has(normalized)) return normalized;
		}
		return null;
	}

	const normalized = normalize(String(value));
	return inboxTerms.has(normalized) ? normalized : null;
}

/**
 * Produces explainable Inbox candidates from metadata only. It never mutates
 * settings or Vault files; the caller must ask the user to choose one.
 */
export function discoverInboxScopeCandidates(files: readonly VaultFileDescriptor[]): ScopeRuleCandidate[] {
	const folderCounts = new Map<string, number>();
	const tagCounts = new Map<string, number>();
	const propertyCounts = new Map<string, { key: string; value: string; count: number }>();

	for (const file of files) {
		const folder = parentDirectory(file.path);
		if (folder && inboxTerms.has(finalDirectory(file.path))) {
			folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
		}

		for (const tag of file.tags || []) {
			const normalizedTag = normalize(tag);
			if (inboxTerms.has(normalizedTag)) {
				tagCounts.set(normalizedTag, (tagCounts.get(normalizedTag) || 0) + 1);
			}
		}

		const properties: Readonly<Record<string, unknown>> = file.properties || {};
		for (const key of Object.keys(properties)) {
			const value = properties[key];
			const normalizedValue = findMatchingInboxTerm(value);
			if (!normalizedValue) continue;
			const candidateKey = `${key}\u0000${normalizedValue}`;
			const existing = propertyCounts.get(candidateKey);
			if (existing) existing.count++;
			else propertyCounts.set(candidateKey, { key, value: normalizedValue, count: 1 });
		}
	}

	const candidates: ScopeRuleCandidate[] = [
		...Array.from(folderCounts, ([path, matchedCount]) => ({
			rule: { type: 'folder' as const, paths: [path], recursive: true },
			label: `文件夹：${path}`,
			evidence: `${matchedCount} 个 Markdown 文件位于名称匹配 Inbox/Capture 的目录。`,
			matchedCount
		})),
		...Array.from(tagCounts, ([tag, matchedCount]) => ({
			rule: { type: 'tag' as const, tags: [tag] },
			label: `标签：#${tag}`,
			evidence: `${matchedCount} 个 Markdown 文件使用该候选标签。`,
			matchedCount
		})),
		...Array.from(propertyCounts.values(), ({ key, value, count }) => ({
			rule: { type: 'property' as const, key, values: [value] },
			label: `属性：${key} = ${value}`,
			evidence: `${count} 个 Markdown 文件使用该候选属性值。`,
			matchedCount: count
		}))
	];

	return candidates.sort((left, right) => right.matchedCount - left.matchedCount || left.label.localeCompare(right.label));
}
