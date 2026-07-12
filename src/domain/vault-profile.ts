export interface VaultFileDescriptor {
	path: string;
	tags?: readonly string[];
	properties?: Readonly<Record<string, unknown>>;
}

export type ScopeRule =
	| { type: 'all-markdown' }
	| { type: 'folder'; paths: readonly string[]; recursive?: boolean }
	| { type: 'tag'; tags: readonly string[] }
	| { type: 'property'; key: string; values: readonly string[] }
	| { type: 'compound'; operator: 'and' | 'or'; rules: readonly ScopeRule[] };

export type JournalProfile =
	| { provider: 'unconfigured' }
	| { provider: 'manual'; daily?: ScopeRule; weekly?: ScopeRule; monthly?: ScopeRule; quarterly?: ScopeRule; yearly?: ScopeRule }
	| { provider: 'obsidian-daily-notes' }
	| { provider: 'notebook-navigator' }
	| { provider: 'periodic-notes' };

export interface VaultProfile {
	schemaVersion: 1;
	id: string;
	label: string;
	journal: JournalProfile;
	inbox?: ScopeRule;
	knowledge?: ScopeRule;
	outputs?: ScopeRule;
	projects?: ScopeRule;
	exclusions: readonly ScopeRule[];
}

export interface LegacyVaultPaths {
	dailyNoteFolder: string;
	inboxFolder: string;
	atomicsFolder: string;
	outputFolder: string;
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase();
}

function normalizeTag(tag: string): string {
	return tag.replace(/^#/, '').trim().toLocaleLowerCase();
}

function parentPath(path: string): string {
	const separatorIndex = path.lastIndexOf('/');
	return separatorIndex === -1 ? '' : path.slice(0, separatorIndex);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function isScopeRule(value: unknown): value is ScopeRule {
	if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') return false;
	if (value.type === 'all-markdown') return true;
	if (value.type === 'folder') {
		return 'paths' in value && isStringArray(value.paths) && (!('recursive' in value) || typeof value.recursive === 'boolean');
	}
	if (value.type === 'tag') return 'tags' in value && isStringArray(value.tags);
	if (value.type === 'property') return 'key' in value && typeof value.key === 'string' && 'values' in value && isStringArray(value.values);
	if (value.type === 'compound') {
		return 'operator' in value
			&& (value.operator === 'and' || value.operator === 'or')
			&& 'rules' in value
			&& Array.isArray(value.rules)
			&& value.rules.every(isScopeRule);
	}
	return false;
}

export function isVaultProfile(value: unknown): value is VaultProfile {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<VaultProfile>;
	return candidate.schemaVersion === 1
		&& typeof candidate.id === 'string'
		&& typeof candidate.label === 'string'
		&& Array.isArray(candidate.exclusions)
		&& candidate.exclusions.every(isScopeRule)
		&& Boolean(candidate.journal);
}

function folderRule(path: string, recursive = true): ScopeRule | undefined {
	const normalized = path.trim();
	return normalized === '' ? undefined : { type: 'folder', paths: [normalized], recursive };
}

/** Converts the pre-profile folder settings into a non-persisted compatibility profile. */
export function createLegacyVaultProfile(paths: LegacyVaultPaths): VaultProfile {
	const daily = folderRule(paths.dailyNoteFolder);
	const exclusions = ['00Templates', '00 Templates', '09Books', '09 Books']
		.map(path => folderRule(path))
		.filter((rule): rule is ScopeRule => rule !== undefined);
	return {
		schemaVersion: 1,
		id: 'legacy-folder-settings',
		label: '现有文件夹设置',
		journal: daily ? { provider: 'manual', daily } : { provider: 'unconfigured' },
		inbox: folderRule(paths.inboxFolder, false),
		knowledge: folderRule(paths.atomicsFolder),
		outputs: folderRule(paths.outputFolder),
		// Preserve the historical empty-note scan exclusions only for compatibility mode.
		exclusions
	};
}

function hasMatchingProperty(value: unknown, expectedValues: readonly string[]): boolean {
	const expected = new Set(expectedValues.map(item => item.trim().toLocaleLowerCase()));
	const values = Array.isArray(value) ? value : [value];
	return values.some(item => expected.has(String(item).trim().toLocaleLowerCase()));
}

export function matchesScopeRule(file: VaultFileDescriptor, rule: ScopeRule): boolean {
	switch (rule.type) {
		case 'all-markdown':
			return true;
		case 'folder': {
			const normalizedFilePath = normalizePath(file.path);
			return rule.paths.some(folder => {
				const normalizedFolder = normalizePath(folder);
				if (normalizedFolder === '') return false;
				if (rule.recursive === false) return parentPath(normalizedFilePath) === normalizedFolder;
				return normalizedFilePath === normalizedFolder || normalizedFilePath.startsWith(`${normalizedFolder}/`);
			});
		}
		case 'tag': {
			const fileTags = new Set((file.tags || []).map(normalizeTag));
			return rule.tags.some(tag => fileTags.has(normalizeTag(tag)));
		}
		case 'property':
			return hasMatchingProperty(file.properties?.[rule.key], rule.values);
		case 'compound':
			return rule.operator === 'and'
				? rule.rules.every(childRule => matchesScopeRule(file, childRule))
				: rule.rules.some(childRule => matchesScopeRule(file, childRule));
	}
}

export function resolveScope<T extends VaultFileDescriptor>(
	files: readonly T[],
	include: ScopeRule,
	exclusions: readonly ScopeRule[] = []
): T[] {
	return files.filter(file => matchesScopeRule(file, include) && !exclusions.some(rule => matchesScopeRule(file, rule)));
}

/** Returns one rule for a set of configured roles without inventing a fallback scope. */
export function unionScopeRules(scopes: readonly (ScopeRule | undefined)[]): ScopeRule | undefined {
	const activeScopes = scopes.filter((scope): scope is ScopeRule => scope !== undefined);
	if (activeScopes.length === 0) return undefined;
	if (activeScopes.length === 1) return activeScopes[0]!;
	return { type: 'compound', operator: 'or', rules: activeScopes };
}
