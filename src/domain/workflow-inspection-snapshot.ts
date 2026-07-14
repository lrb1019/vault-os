export type WorkflowIssueStatus = 'new' | 'persistent' | 'resolved' | 'unknown';

export interface WorkflowIssueIdentity {
	id: string;
	title: string;
}

export interface WorkflowInspectionSnapshot {
	ruleSetVersion: number;
	capturedAt: string;
	issues: WorkflowIssueIdentity[];
}

export interface WorkflowInspectionDiff {
	comparable: boolean;
	current: Array<WorkflowIssueIdentity & { status: WorkflowIssueStatus }>;
	resolved: Array<WorkflowIssueIdentity & { status: 'resolved' }>;
}

export function isWorkflowInspectionSnapshot(value: unknown): value is WorkflowInspectionSnapshot {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<WorkflowInspectionSnapshot>;
	return typeof candidate.ruleSetVersion === 'number'
		&& Number.isInteger(candidate.ruleSetVersion)
		&& typeof candidate.capturedAt === 'string'
		&& Array.isArray(candidate.issues)
		&& candidate.issues.every(issue => Boolean(issue)
			&& typeof issue === 'object'
			&& typeof issue.id === 'string'
			&& typeof issue.title === 'string');
}

export function compareWorkflowInspectionSnapshot(
	current: readonly WorkflowIssueIdentity[],
	previous: WorkflowInspectionSnapshot | undefined,
	ruleSetVersion: number
): WorkflowInspectionDiff {
	if (!previous || previous.ruleSetVersion !== ruleSetVersion) {
		return { comparable: false, current: current.map(issue => ({ ...issue, status: 'unknown' })), resolved: [] };
	}
	const previousIds = new Set(previous.issues.map(issue => issue.id));
	const currentIds = new Set(current.map(issue => issue.id));
	return {
		comparable: true,
		current: current.map(issue => ({ ...issue, status: previousIds.has(issue.id) ? 'persistent' : 'new' })),
		resolved: previous.issues.filter(issue => !currentIds.has(issue.id)).map(issue => ({ ...issue, status: 'resolved' }))
	};
}
