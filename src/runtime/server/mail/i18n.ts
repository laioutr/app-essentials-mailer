export type EmailContentLanguage = 'de' | 'en';
export type EmailTextDirection = 'ltr' | 'rtl';

export interface EmailLocaleContext {
  contentLanguage: EmailContentLanguage;
  direction: EmailTextDirection;
  formatLocale: string;
  timeZone: string;
}

/** Content languages the mailer currently ships; unsupported languages use English copy. */
export function resolveContentLanguage(locale: string): EmailContentLanguage {
  return locale.split('-')[0].toLowerCase() === 'de' ? 'de' : 'en';
}

/** Canonical IANA timezone, with UTC as the compatibility fallback. */
export function resolveTimeZone(timeZone?: string): string {
  if (!timeZone) return 'UTC';

  try {
    return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return 'UTC';
    throw error;
  }
}

export function resolveEmailLocale(locale: string, timeZone?: string): EmailLocaleContext {
  return {
    contentLanguage: resolveContentLanguage(locale),
    direction: 'ltr',
    formatLocale: locale,
    timeZone: resolveTimeZone(timeZone),
  };
}
