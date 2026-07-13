import assert from 'node:assert/strict';
import test from 'node:test';
import { hasDailyQuoteCache, hasDailyWeatherCache, resolveQuoteLanguage, weatherPresentation } from '../src/domain/daily-context.ts';

void test('chooses a deterministic provider for mixed daily quotes', () => {
	assert.equal(resolveQuoteLanguage('zh', '2026-07-13'), 'zh');
	assert.equal(resolveQuoteLanguage('en', '2026-07-13'), 'en');
	assert.equal(resolveQuoteLanguage('mixed', '2026-07-13'), resolveQuoteLanguage('mixed', '2026-07-13'));
});

void test('maps weather codes to neutral display data', () => {
	assert.deepEqual(weatherPresentation(0), { condition: '晴朗', icon: 'sun' });
	assert.deepEqual(weatherPresentation(63), { condition: '有雨', icon: 'cloud-rain' });
});

void test('keeps weather and quote cache freshness independent across days', () => {
	const cache = {
		weatherDate: '2026-07-13',
		weatherCity: '临沂',
		weather: { city: '临沂', temperature: 27, condition: '有雨', icon: 'cloud-rain' },
		quoteDate: '2026-07-12',
		quoteLanguage: 'en' as const,
		quote: { text: 'Yesterday', author: 'Author', language: 'en' as const, provider: 'ZenQuotes' as const, url: 'https://zenquotes.io/' }
	};
	assert.equal(hasDailyWeatherCache(cache, '临沂', '2026-07-13'), true);
	assert.equal(hasDailyQuoteCache(cache, 'en', '2026-07-13'), false);
});
