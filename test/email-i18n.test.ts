import { describe, expect, it } from 'vitest';
import {
  resolveContentLanguage,
  resolveEmailLocale,
  resolveTimeZone,
} from '../src/runtime/server/mail/i18n';

describe('email i18n resolution', () => {
  it('selects German by language subtag and otherwise falls back to English', () => {
    expect(resolveContentLanguage('de-CH')).toBe('de');
    expect(resolveContentLanguage('en-GB')).toBe('en');
    expect(resolveContentLanguage('fr-FR')).toBe('en');
  });

  it('preserves the full formatting locale and describes supported content', () => {
    expect(resolveEmailLocale('de-AT', 'Europe/Berlin')).toEqual({
      contentLanguage: 'de',
      direction: 'ltr',
      formatLocale: 'de-AT',
      timeZone: 'Europe/Berlin',
    });
  });

  it('uses UTC when no timezone is configured', () => {
    expect(resolveTimeZone()).toBe('UTC');
  });

  it('canonicalizes valid zones and falls back to UTC for invalid zones', () => {
    expect(resolveTimeZone('europe/berlin')).toBe('Europe/Berlin');
    expect(resolveTimeZone('Not/AZone')).toBe('UTC');
  });
});
