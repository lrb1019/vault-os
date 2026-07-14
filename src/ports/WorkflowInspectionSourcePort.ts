import type { ScopeRule, VaultProfile } from '../domain/vault-profile.ts';
import type { WorkflowInspectionSecurityState } from '../domain/workflow-inspection-security.ts';

export interface WorkflowInspectionFile {
	path: string;
	tags: string[];
	properties: Record<string, unknown> | undefined;
	resolvedLinks: string[];
	resolvedSupports: string[];
	declaredSupports?: string[];
	invalidSupports?: string[];
	unresolvedSupports?: string[];
}

export interface WorkflowInspectionSourceData {
	security: WorkflowInspectionSecurityState;
	projects: WorkflowInspectionFile[];
	projectEntries?: ScopeRule;
	outputs: WorkflowInspectionFile[];
	outputEntries?: ScopeRule;
	knowledge: WorkflowInspectionFile[];
}

export interface WorkflowInspectionSourcePort {
	read(profile: VaultProfile): WorkflowInspectionSourceData;
}
