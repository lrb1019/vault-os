import type { ClaimUsageSourceKind } from './claim-usage.ts';
import type { VaultFileDescriptor } from './vault-profile.ts';

const excludedKinds: Array<{ kind: Exclude<ClaimUsageSourceKind, 'project-entity' | 'output' | 'other'>; values: readonly string[] }> = [
	{ kind: 'index', values: ['index', '索引'] },
	{ kind: 'template', values: ['template', '模板'] },
	{ kind: 'health-report', values: ['health-report', 'health report', '体检报告'] },
	// Evidence-debt reports may use descriptive suffixes such as "证据债务优先级".
	{ kind: 'evidence-debt-report', values: ['evidence-debt-report', 'evidence debt', '证据债务'] },
	{ kind: 'audit-document', values: ['audit', '审计'] },
	{ kind: 'project-management', values: ['project-management', 'project management', '项目管理'] }
];

function valuesFromProperties(properties: VaultFileDescriptor['properties']): string[] {
	if (!properties) return [];
	const values: string[] = [];
	for (const key of ['type', 'card_type', 'layer', 'document_type', 'report_type', 'category']) {
		const raw: unknown = properties[key];
		const candidates: unknown[] = Array.isArray(raw) ? raw : [raw];
		for (const candidate of candidates) {
			if (typeof candidate === 'string') values.push(candidate.normalize('NFKC').trim().toLocaleLowerCase());
		}
	}
	return values;
}

/**
 * Output scopes are intentionally not trusted as usage sources by themselves.
 * Structured classification keeps system documents out before Claim analysis.
 */
export function classifyClaimUsageSource(file: VaultFileDescriptor): ClaimUsageSourceKind {
	const values = valuesFromProperties(file.properties);
	const filename = file.path.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/iu, '').normalize('NFKC').toLocaleLowerCase() || '';
	for (const entry of excludedKinds) {
		if (values.some(value => entry.values.includes(value)) || entry.values.some(value => filename.includes(value))) return entry.kind;
	}
	return 'output';
}
