export interface StatCardData {
	title: string;
	value: string | number;
	subtitle: string;
	badge?: string;
	badgeType?: 'success' | 'warning' | 'info' | 'normal';
}

export interface ReadingProgress {
	bookName: string;
	progressPercent: number;
	lastReadTime: string;
}

export interface InboxBacklog {
	count: number;
	oldestDays: number;
	needRouting: number;
}

export interface TaskOverview {
	todayCount: number;
	completedCount: number;
	overdueCount: number;
}

export interface BookReflection {
	bookName: string;
	progress: string;
	lastRead: string;
	reflection: string;
}

export interface DiaryStatus {
	isCreated: boolean;
	path: string;
	summary: string;
}

export interface HeatmapDay {
	date: string;
	level: 0 | 1 | 2 | 3 | 4; // Contribution level
	count: number;
}

export const mockReadingProgress: ReadingProgress = {
	bookName: "《设计心理学》",
	progressPercent: 68,
	lastReadTime: "2小时前"
};

export const mockInboxBacklog: InboxBacklog = {
	count: 12,
	oldestDays: 5,
	needRouting: 3
};

export const mockTaskOverview: TaskOverview = {
	todayCount: 8,
	completedCount: 5,
	overdueCount: 1
};

export const mockDiaryStatus: DiaryStatus = {
	isCreated: true,
	path: "01 Daily/2026-06-22.md",
	summary: "今日重点：开始进行 Vault OS UI 插件迁移；已读书半小时；处理了 Inbox 里的几篇技术文章。"
};

export const mockRecentReads: BookReflection[] = [
	{
		bookName: "《集异璧之大成》",
		progress: "35%",
		lastRead: "昨日",
		reflection: "对于系统同构和自指有了更深的理解，打算写一篇关于智能体自指逻辑的原子笔记。"
	},
	{
		bookName: "《卡片笔记写作法》",
		progress: "100%",
		lastRead: "3天前",
		reflection: "原子笔记的扁平化结构非常契合卢曼的卡片盒原则。拆分 Atomics 时要更坚决。"
	},
	{
		bookName: "《黑客与画家》",
		progress: "82%",
		lastRead: "5天前",
		reflection: "创造力是核心。智能体可以作为我们思考的延伸，但不应代替核心的决策。"
	}
];

// Helper to generate heatmap mock data for the last 15 weeks (approx 105 days)
export const getMockHeatmapData = (): HeatmapDay[] => {
	const data: HeatmapDay[] = [];
	const now = new Date(2026, 5, 22); // Assume current date is June 22, 2026
	
	// Generate 105 days of data ending today
	for (let i = 104; i >= 0; i--) {
		const date = new Date(now);
		date.setDate(now.getDate() - i);
		
		const dateString = date.toISOString().split('T')[0] || '';
		// Mock levels: more contributions on weekdays, less on weekends
		const dayOfWeek = date.getDay();
		let level: 0 | 1 | 2 | 3 | 4 = 0;
		let count = 0;
		
		if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Weekday
			const rand = Math.random();
			if (rand > 0.8) { level = 4; count = Math.floor(Math.random() * 5) + 12; }
			else if (rand > 0.5) { level = 3; count = Math.floor(Math.random() * 4) + 8; }
			else if (rand > 0.2) { level = 2; count = Math.floor(Math.random() * 5) + 3; }
			else { level = 1; count = Math.floor(Math.random() * 2) + 1; }
		} else { // Weekend
			const rand = Math.random();
			if (rand > 0.9) { level = 2; count = Math.floor(Math.random() * 3) + 3; }
			else if (rand > 0.5) { level = 1; count = Math.floor(Math.random() * 2) + 1; }
			else { level = 0; count = 0; }
		}
		
		data.push({
			date: dateString,
			level,
			count
		});
	}
	return data;
};
