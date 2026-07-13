import { requestUrl } from 'obsidian';
import VaultOsPlugin from '../main';
import { DEFAULT_DAILY_CONTEXT_SETTINGS, getLocalDayKey, hasDailyQuoteCache, hasDailyWeatherCache, resolveQuoteLanguage, weatherPresentation, type DailyContextCache, type DailyContextSettings, type DailyExternalQuote, type DailyWeather } from '../domain/daily-context';

interface GeocodingResponse { results?: Array<{ latitude: number; longitude: number; name: string }> }
interface WeatherResponse { current?: { temperature_2m?: number; weather_code?: number } }
interface HitokotoResponse { hitokoto?: string; from?: string; from_who?: string; uuid?: string }
interface ZenQuoteResponse { q?: string; a?: string }

export class DailyContextService {
	constructor(private readonly plugin: VaultOsPlugin) {}

	getSettings(): DailyContextSettings {
		return { ...DEFAULT_DAILY_CONTEXT_SETTINGS, ...this.plugin.settings.dailyContext };
	}

	async getWeather(): Promise<DailyWeather | undefined> {
		const settings = this.getSettings();
		const city = settings.weatherCity.trim();
		const today = getLocalDayKey();
		if (!settings.weatherEnabled || !city) return undefined;
		if (hasDailyWeatherCache(settings.cache, city, today)) return settings.cache.weather;
		const weather = await this.fetchOpenMeteo(city);
		await this.saveCache({ ...settings.cache, weatherDate: today, weatherCity: city, weather });
		return weather;
	}

	private async fetchOpenMeteo(city: string): Promise<DailyWeather> {
		const location = await requestUrl({ url: `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json` });
		const place = (location.json as GeocodingResponse).results?.[0];
		if (!place) throw new Error('未找到该城市');
		const forecast = await requestUrl({ url: `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&timezone=auto` });
		const current = (forecast.json as WeatherResponse).current;
		if (typeof current?.temperature_2m !== 'number' || typeof current.weather_code !== 'number') throw new Error('天气服务返回不完整');
		return { city: place.name || city, temperature: Math.round(current.temperature_2m), ...weatherPresentation(current.weather_code) };
	}


	async getQuote(): Promise<DailyExternalQuote | undefined> {
		const settings = this.getSettings();
		const today = getLocalDayKey();
		if (!settings.quoteEnabled) return undefined;
		if (hasDailyQuoteCache(settings.cache, settings.quoteLanguage, today)) return settings.cache.quote;
		const language = resolveQuoteLanguage(settings.quoteLanguage, today);
		const quote = language === 'zh' ? await this.fetchChineseQuote() : await this.fetchEnglishQuote();
		await this.saveCache({ ...settings.cache, quoteDate: today, quoteLanguage: settings.quoteLanguage, quote });
		return quote;
	}

	private async fetchChineseQuote(): Promise<DailyExternalQuote> {
		const response = await requestUrl({ url: 'https://v1.hitokoto.cn/?c=d&c=i&c=k&encode=json&min_length=8&max_length=52' });
		const data = response.json as HitokotoResponse;
		if (!data.hitokoto) throw new Error('一言服务返回不完整');
		return { text: data.hitokoto, author: data.from_who || data.from || '一言', language: 'zh', provider: 'Hitokoto', url: data.uuid ? `https://hitokoto.cn?uuid=${data.uuid}` : 'https://hitokoto.cn/' };
	}

	private async fetchEnglishQuote(): Promise<DailyExternalQuote> {
		const response = await requestUrl({ url: 'https://zenquotes.io/api/today' });
		const data = response.json as ZenQuoteResponse[];
		const quote = data[0];
		if (!quote?.q) throw new Error('ZenQuotes 服务返回不完整');
		return { text: quote.q, author: quote.a || 'Unknown', language: 'en', provider: 'ZenQuotes', url: 'https://zenquotes.io/' };
	}

	private async saveCache(cache: DailyContextCache): Promise<void> {
		const current = this.getSettings();
		this.plugin.settings.dailyContext = { ...current, cache: { ...current.cache, ...cache } };
		await this.plugin.saveSettings();
	}
}
