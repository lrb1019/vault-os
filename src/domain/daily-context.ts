export type ExternalQuoteLanguage = 'zh' | 'en' | 'mixed';

export interface DailyWeather {
	city: string;
	temperature: number;
	condition: string;
	icon: string;
}

export interface DailyExternalQuote {
	text: string;
	author: string;
	language: 'zh' | 'en';
	provider: 'Hitokoto' | 'ZenQuotes';
	url: string;
}

export interface DailyContextCache {
	weather?: DailyWeather;
	weatherCity?: string;
	weatherDate?: string;
	quote?: DailyExternalQuote;
	quoteLanguage?: ExternalQuoteLanguage;
	quoteDate?: string;
}

export interface DailyContextSettings {
	weatherEnabled: boolean;
	weatherCity: string;
	quoteEnabled: boolean;
	quoteLanguage: ExternalQuoteLanguage;
	cache?: DailyContextCache;
}

export const DEFAULT_DAILY_CONTEXT_SETTINGS: DailyContextSettings = {
	weatherEnabled: false,
	weatherCity: '',
	quoteEnabled: false,
	quoteLanguage: 'zh'
};

export function getLocalDayKey(date = new Date()): string {
	const offset = date.getTimezoneOffset() * 60000;
	return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function stableHash(value: string): number {
	let hash = 0;
	for (const character of value) hash = Math.imul(31, hash) + character.charCodeAt(0) | 0;
	return hash >>> 0;
}

export function resolveQuoteLanguage(language: ExternalQuoteLanguage, dayKey: string): 'zh' | 'en' {
	if (language !== 'mixed') return language;
	return stableHash(dayKey) % 2 === 0 ? 'zh' : 'en';
}

export function hasDailyWeatherCache(cache: DailyContextCache | undefined, city: string, dayKey: string): cache is DailyContextCache & { weather: DailyWeather } {
	return cache?.weatherDate === dayKey && cache.weatherCity === city && cache.weather !== undefined;
}

export function hasDailyQuoteCache(cache: DailyContextCache | undefined, language: ExternalQuoteLanguage, dayKey: string): cache is DailyContextCache & { quote: DailyExternalQuote } {
	return cache?.quoteDate === dayKey && cache.quoteLanguage === language && cache.quote !== undefined;
}

export function weatherPresentation(code: number): Pick<DailyWeather, 'condition' | 'icon'> {
	if (code === 0) return { condition: '晴朗', icon: 'sun' };
	if (code <= 2) return { condition: '少云', icon: 'cloud-sun' };
	if (code === 3) return { condition: '多云', icon: 'cloud' };
	if (code <= 48) return { condition: '雾', icon: 'cloud-fog' };
	if (code <= 67) return { condition: '有雨', icon: 'cloud-rain' };
	if (code <= 77) return { condition: '有雪', icon: 'cloud-snow' };
	if (code <= 82) return { condition: '阵雨', icon: 'cloud-rain' };
	return { condition: '雷雨', icon: 'cloud-lightning' };
}
