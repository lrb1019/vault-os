export interface SupportsReference {
	raw: string;
	linkpath: string;
}

export interface SupportsParseResult {
	references: SupportsReference[];
	invalidValues: string[];
}

function parseWikiLink(raw: string): SupportsReference | undefined {
	const target = raw.split('|', 1)[0]?.split(/[#^]/u, 1)[0]?.trim();
	if (!target) return undefined;
	return { raw, linkpath: target };
}

/**
 * Parses structured Evidence.supports values without interpreting arbitrary
 * body links as evidence. Obsidian resolves the returned linkpaths later.
 */
export function parseSupportsReferences(value: unknown): SupportsParseResult {
	const isEmptyArray = Array.isArray(value) && value.length === 0;
	const values = typeof value === 'string'
		? [value]
		: Array.isArray(value) && value.every(item => typeof item === 'string')
			? value
			: [];
	const invalidValues: string[] = [];
	if (value !== undefined && !isEmptyArray && values.length === 0) invalidValues.push('supports 必须是字符串或字符串数组');

	const references: SupportsReference[] = [];
	for (const valueItem of values) {
		const matches = [...valueItem.matchAll(/\[\[([^\]]+)\]\]/gu)];
		if (matches.length === 0) {
			invalidValues.push(valueItem);
			continue;
		}
		for (const match of matches) {
			const reference = parseWikiLink(match[1] || '');
			if (reference) references.push(reference);
			else invalidValues.push(match[0]);
		}
	}

	return { references, invalidValues };
}
