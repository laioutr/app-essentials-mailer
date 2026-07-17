import Handlebars from 'handlebars';
import { convert } from 'html-to-text';
import type { MailRenderContext } from './types';
import { formEmailLayout } from '../../../emails/compiled/form-email';
import { resolveEmailLocale } from '../i18n';

export interface FormEmailField {
  label: string;
  value: string;
}

export interface RenderFormEmailOptions {
  /** Config/request-derived context (locale, timezone, brand). The layout is owned here. */
  ctx: MailRenderContext;
  heading: string;
  intro: string;
  formType: string;
  fields: FormEmailField[];
  submittedAt: Date;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/** Row-label chrome the layout itself owns, by language. */
const CHROME = {
  de: { formType: 'Formulartyp', submittedAt: 'Eingegangen am' },
  en: { formType: 'Form type', submittedAt: 'Received at' },
} as const;

/** Compiled once — the layout is a static module constant (Handlebars compiles lazily on import). */
const template = Handlebars.compile(formEmailLayout);

/**
 * Pure: fills the precompiled Maizzle form-email layout with per-request data via Handlebars.
 * Handlebars is a small runtime template engine; its default `{{ }}` escaping HTML-escapes every
 * interpolated value, so callers pass raw strings and untrusted user input can never inject markup.
 */
export function renderFormEmail(opts: RenderFormEmailOptions): RenderedEmail {
  const { ctx } = opts;
  const { contentLanguage, direction, formatLocale, timeZone } = resolveEmailLocale(
    ctx.locale,
    ctx.timeZone,
  );
  const chrome = CHROME[contentLanguage];
  const submittedAt = new Intl.DateTimeFormat(formatLocale, {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone,
  }).format(opts.submittedAt);
  const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(opts.submittedAt);

  const html = template({
    heading: opts.heading,
    intro: opts.intro,
    formType: opts.formType,
    formTypeLabel: chrome.formType,
    submittedAt,
    submittedAtLabel: chrome.submittedAt,
    fields: opts.fields,
    htmlLang: contentLanguage,
    textDirection: direction,
    timeZone,
    shopName: ctx.shopName,
    shopUrl: ctx.shopUrl,
    footerLinks: ctx.footerLinks,
    year,
  });

  const text = convert(html, { wordwrap: false });
  return { html, text };
}
