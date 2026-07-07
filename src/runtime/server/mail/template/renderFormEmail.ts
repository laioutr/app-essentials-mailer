import { convert } from 'html-to-text';

export interface FormEmailField {
  label: string;
  value: string;
}

export interface RenderFormEmailOptions {
  /** Compiled shell with {{scalar}} tokens and a {{{fields}}} raw slot. */
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A full, inline-styled table of label/value rows (injected into the shell's {{{fields}}} slot). */
function renderFieldsTable(fields: FormEmailField[]): string {
  const rows = fields
    .map(
      (f) =>
        `<tr><td style="padding:4px 8px;font-weight:bold;">${escapeHtml(f.label)}</td>` +
        `<td style="padding:4px 8px;">${escapeHtml(f.value)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
}

/**
 * Pure: fills a precompiled Maizzle shell with per-request data. No email framework at runtime.
 * Function replacers are used so values containing `$` are inserted literally.
 */
export function renderFormEmail(opts: RenderFormEmailOptions): RenderedEmail {
  const lang = opts.locale.split('-')[0].toLowerCase();
  const chrome = CHROME[lang as keyof typeof CHROME] ?? CHROME.en;
  const submittedAt = new Intl.DateTimeFormat(opts.locale, {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(opts.submittedAt);

  const replacements: Record<string, string> = {
    '{{heading}}': escapeHtml(opts.heading),
    '{{intro}}': escapeHtml(opts.intro),
    '{{formType}}': escapeHtml(opts.formType),
    '{{formTypeLabel}}': escapeHtml(chrome.formType),
    '{{submittedAt}}': escapeHtml(submittedAt),
    '{{submittedAtLabel}}': escapeHtml(chrome.submittedAt),
    '{{{fields}}}': renderFieldsTable(opts.fields),
  };

  let html = opts.shell;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replaceAll(token, () => value);
  }

  const text = convert(html, { wordwrap: false });
  return { html, text };
}
