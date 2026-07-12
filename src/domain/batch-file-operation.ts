export interface FileOperationCandidate {
	path: string;
}

export interface BatchFileOperationItem {
	path: string;
	status: 'success' | 'failed';
	errorMessage?: string;
}

export interface BatchFileOperationResult {
	requestedCount: number;
	succeededCount: number;
	failedCount: number;
	items: BatchFileOperationItem[];
}

/**
 * Executes only the explicitly selected candidates and keeps processing after
 * an individual failure so the caller can report an actionable result.
 */
export async function executeSelectedFileOperation<T extends FileOperationCandidate>(
	candidates: readonly T[],
	selectedPaths: readonly string[],
	execute: (candidate: T) => Promise<void>
): Promise<BatchFileOperationResult> {
	const selected = new Set(selectedPaths);
	const targets = candidates.filter(candidate => selected.has(candidate.path));
	const items: BatchFileOperationItem[] = [];

	for (const candidate of targets) {
		try {
			await execute(candidate);
			items.push({ path: candidate.path, status: 'success' });
		} catch (error) {
			items.push({
				path: candidate.path,
				status: 'failed',
				errorMessage: error instanceof Error ? error.message : String(error)
			});
		}
	}

	const succeededCount = items.filter(item => item.status === 'success').length;
	return {
		requestedCount: targets.length,
		succeededCount,
		failedCount: items.length - succeededCount,
		items
	};
}
