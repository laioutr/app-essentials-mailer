import Handlebars from 'handlebars';
import { convert } from 'html-to-text';

export interface FormEmailField {
  label: string;
  value: string;
}

export interface RenderFormEmailOptions {
  /**
   * Compiled Maizzle shell: a Handlebars template with {{scalar}} tokens and a
   * {{#each fields}} row loop. Authored in `emails/*.vue`, built by `build:emails`.
   */
  shell: string;
  heading: string;
  intro: string;
  formType: string;
  fields: FormEmailField[];
  submittedAt: Date;
  /** BCP-47 locale; used for chrome labels + UTC date formatting. */
  locale: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/** Row-label chrome the template itself owns, by language. */
const CHROME = {
  de: { formType: 'Formulartyp', submittedAt: 'Eingegangen am' },
  en: { formType: 'Form type', submittedAt: 'Received at' },
} as const;

/**
 * Compiled-template cache keyed by shell string. Shells are static module constants,
 * so each is parsed by Handlebars once and reused across every request.
 */
const compiled = new Map<string, ReturnType<typeof Handlebars.compile>>();

function compileShell(shell: string): ReturnType<typeof Handlebars.compile> {
  let template = compiled.get(shell);
  if (!template) {
    template = Handlebars.compile(shell);
    compiled.set(shell, template);
  }
  return template;
}

/**
 * Pure: fills a precompiled Maizzle shell with per-request data via Handlebars.
 * Handlebars is a small runtime template engine (no email framework at runtime); its
 * default `{{ }}` escaping HTML-escapes every interpolated value, so callers pass raw
 * strings and untrusted user input can never inject markup.
 */
export function renderFormEmail(opts: RenderFormEmailOptions): RenderedEmail {
  const lang = opts.locale.split('-')[0].toLowerCase();
  const chrome = CHROME[lang as keyof typeof CHROME] ?? CHROME.en;
  const submittedAt = new Intl.DateTimeFormat(opts.locale, {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(opts.submittedAt);

  const html = compileShell(opts.shell)({
    heading: opts.heading,
    intro: opts.intro,
    formType: opts.formType,
    formTypeLabel: chrome.formType,
    submittedAt,
    submittedAtLabel: chrome.submittedAt,
    fields: opts.fields,
  });

  const text = convert(html, { wordwrap: false });
  return { html, text };
}
