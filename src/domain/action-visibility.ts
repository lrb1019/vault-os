export interface HomeActionCandidate {
	enabled?: boolean;
	requireInput: boolean;
	showOnHome?: boolean;
}

/** Only direct, explicitly permitted actions belong on the home dashboard. */
export function shouldShowActionOnHome(action: HomeActionCandidate): boolean {
	return action.enabled !== false && !action.requireInput && action.showOnHome !== false;
}
