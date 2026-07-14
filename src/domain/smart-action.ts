export interface SmartActionCategory {
	id: string;
	label: string;
	description?: string;
	icon: string;
}

export interface SmartAction {
	id: string;
	label: string;
	description?: string;
	icon: string;
	prompt: string;
	requireInput: boolean;
	enabled?: boolean;
	inputPlaceholder?: string;
	categoryId?: string;
}

export const DEFAULT_SMART_ACTION_CATEGORIES: readonly SmartActionCategory[] = [
	{ id: 'workflow', label: '工作流', description: '处理输入、整理与知识回流。', icon: 'git-branch' },
	{ id: 'maintenance', label: '维护与诊断', description: '检查、清理与报告。', icon: 'shield-check' },
	{ id: 'research', label: '研究与内容', description: '检索、研究与内容创作。', icon: 'book-open' },
	{ id: 'journal', label: '日记与复盘', description: '围绕日记、复盘与周期记录。', icon: 'notebook-pen' },
	{ id: 'unclassified', label: '未分类', description: '尚未归入其他面板的指令。', icon: 'folder-open' }
];

const legacyDefaultActionCategories: Readonly<Record<string, string>> = {
	'action-1': 'workflow',
	'action-2': 'maintenance',
	'action-3': 'maintenance',
	'action-4': 'maintenance',
	'action-5': 'research',
	'action-6': 'research'
};

export function normalizeSmartActionCategories(value: unknown): SmartActionCategory[] {
	if (!Array.isArray(value)) return DEFAULT_SMART_ACTION_CATEGORIES.map(category => ({ ...category }));
	const categories = value.flatMap(item => {
		if (!item || typeof item !== 'object') return [];
		const candidate = item as Partial<SmartActionCategory>;
		if (typeof candidate.id !== 'string' || candidate.id.trim() === '' || typeof candidate.label !== 'string' || candidate.label.trim() === '') return [];
		return [{
			id: candidate.id.trim(),
			label: candidate.label.trim(),
			description: typeof candidate.description === 'string' ? candidate.description.trim() : '',
			icon: typeof candidate.icon === 'string' && candidate.icon.trim() !== '' ? candidate.icon.trim() : 'folder-open'
		}];
	});
	return categories.some(category => category.id === 'unclassified')
		? categories
		: [...categories, { id: 'unclassified', label: '未分类', description: '尚未归入其他面板的指令。', icon: 'folder-open' }];
}

export function resolveSmartActionCategoryId(action: Pick<SmartAction, 'id' | 'categoryId'>, categories: readonly SmartActionCategory[]): string {
	const requestedCategoryId = action.categoryId || legacyDefaultActionCategories[action.id];
	return requestedCategoryId && categories.some(category => category.id === requestedCategoryId)
		? requestedCategoryId
		: 'unclassified';
}

export function requiresSmartActionInput(action: Pick<SmartAction, 'requireInput'>): boolean {
	return action.requireInput === true;
}
