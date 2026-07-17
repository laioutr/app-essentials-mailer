import { describe, expect, it } from 'vitest';
import type { MailRenderContext } from '../src/runtime/server/mail/template/types';
import { renderFormEmail } from '../src/runtime/server/mail/template/renderFormEmail';

const ctx: MailRenderContext = {
  locale: 'en-US',
  shopName: 'Example Shop',
  shopUrl: 'https://shop.example',
  footerLinks: [
    { label: 'Imprint', url: 'https://shop.example/imprint' },
    { label: 'Privacy', url: 'https://shop.example/privacy' },
  ],
};

const base = {
  ctx,
  heading: 'New withdrawal',
  intro: 'A new withdrawal has been submitted.',
  formType: 'Withdrawal',
  fields: [
    { label: 'Name', value: 'Alice Example' },
    { label: 'Order reference', value: 'ORD-42' },
    { label: 'Email address', value: 'alice@example.com' },
  ],
  submittedAt: new Date('2026-07-06T10:30:00Z'),
};

/** base with ctx fields overridden. */
const withCtx = (over: Partial<MailRenderContext>) => ({ ...base, ctx: { ...ctx, ...over } });

describe('renderFormEmail', () => {
  it('substitutes scalars, renders a row per field via the loop, and resolves every token', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('New withdrawal');
    expect(html).toContain('A new withdrawal has been submitted.');
    expect(html).toContain('Withdrawal');
    for (const f of base.fields) {
      expect(html).toContain(f.label);
      expect(html).toContain(f.value);
    }
    // One value cell per field — the {{#each}} loop ran. Only field value cells are right-aligned.
    expect(html.match(/text-align: right/g)).toHaveLength(base.fields.length);
    expect(html).not.toContain('{{');
  });

  it('formats submittedAt in UTC by default and uses English metadata and chrome', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('lang="en" dir="ltr"');
    expect(html).toContain('xml:lang="en" dir="ltr"');
    expect(html).toContain('July 6, 2026 at 10:30:00 AM');
    expect(html).toContain('(UTC)');
    expect(html).toContain('Form type');
    expect(html).toContain('Received at');
  });

  it('uses German metadata and chrome for a de locale', () => {
    const { html } = renderFormEmail(withCtx({ locale: 'de-DE' }));
    expect(html).toContain('lang="de" dir="ltr"');
    expect(html).toContain('xml:lang="de" dir="ltr"');
    expect(html).toContain('Formulartyp');
    expect(html).toContain('Eingegangen am');
  });

  it('uses English copy metadata for an unsupported content language', () => {
    const { html } = renderFormEmail(withCtx({ locale: 'fr-FR' }));
    expect(html).toContain('lang="en" dir="ltr"');
    expect(html).toContain('Form type');
    expect(html).toContain('Received at');
  });

  it('formats the timestamp in a configured canonical IANA timezone', () => {
    const { html } = renderFormEmail(withCtx({ timeZone: 'europe/berlin' }));
    expect(html).toContain('July 6, 2026 at 12:30:00 PM');
    expect(html).toContain('(Europe/Berlin)');
  });

  it('falls back to UTC when the configured timezone is invalid', () => {
    const { html } = renderFormEmail(withCtx({ timeZone: 'Not/AZone' }));
    expect(html).toContain('July 6, 2026 at 10:30:00 AM');
    expect(html).toContain('(UTC)');
  });

  it('derives the copyright year in the effective timezone', () => {
    const { html } = renderFormEmail({
      ...withCtx({ timeZone: 'Europe/Berlin' }),
      submittedAt: new Date('2025-12-31T23:30:00Z'),
    });
    expect(html).toContain('January 1, 2026 at 12:30:00 AM');
    expect(html).toContain('© 2026 Example Shop');
  });

  it('renders the shop-name header (linked) and a footer copyright with the shop name + year', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('href="https://shop.example"'); // header link (exact, no trailing path)
    expect(html).toContain('>Example Shop</a>');
    expect(html).toContain('© 2026 Example Shop');
  });

  it('renders each footer link in order, joined by a separator', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('href="https://shop.example/imprint"');
    expect(html).toContain('href="https://shop.example/privacy"');
    expect(html).toContain('&middot;'); // separator entity between links
    expect(html.indexOf('Imprint')).toBeLessThan(html.indexOf('Privacy')); // order preserved
  });

  it('omits the footer link section when no links are configured, keeping header + copyright', () => {
    const { html } = renderFormEmail(withCtx({ footerLinks: undefined }));
    expect(html).not.toContain('href="https://shop.example/imprint"');
    expect(html).toContain('Example Shop'); // header + copyright still present
    expect(html).not.toContain('{{');
  });

  it('renders the shop name as plain text (no link) when shopUrl is omitted', () => {
    const { html } = renderFormEmail(withCtx({ shopUrl: undefined }));
    expect(html).toContain('>Example Shop</span>'); // styled span, not an anchor
    expect(html).not.toContain('href="https://shop.example"'); // no header link (footer paths differ)
  });

  it('HTML-escapes user-supplied values (Handlebars default escaping)', () => {
    const { html } = renderFormEmail({
      ...base,
      fields: [{ label: 'Name', value: 'Müller & <script>x</script>' }],
    });
    expect(html).toContain('Müller &amp; &lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('inserts values containing "$" literally (no regex-replacement mangling)', () => {
    const { html } = renderFormEmail({
      ...base,
      fields: [{ label: 'Amount', value: 'Total $5 & $&later' }],
    });
    expect(html).toContain('Total $5 &amp; $&amp;later');
  });

  it('derives plaintext with no HTML tags', () => {
    const { text } = renderFormEmail(base);
    expect(text).toContain('Alice Example');
    expect(text).not.toMatch(/<[a-z]/i);
  });
});
