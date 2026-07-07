import { describe, expect, it } from 'vitest';
import { renderFormEmail } from '../src/runtime/server/mail/template/renderFormEmail';

// Fixture shell mirroring the compiled Maizzle output: {{scalar}} tokens, a {{#each fields}}
// loop, the header {{#if shopUrl}} conditional, and the {{#if footerLinks}}/{{#each}} footer.
const shell = [
  '{{#if shopUrl}}<a href="{{shopUrl}}">{{shopName}}</a>{{else}}<span>{{shopName}}</span>{{/if}}',
  '<p><span>{{heading}}</span></p>',
  '<p><span>{{intro}}</span></p>',
  '<p><strong><span>{{formTypeLabel}}</span>:</strong> <span>{{formType}}</span></p>',
  '<table><tbody>{{#each fields}}<tr><td>{{label}}</td><td>{{value}}</td></tr>{{/each}}</tbody></table>',
  '<p><strong><span>{{submittedAtLabel}}</span>:</strong> <span>{{submittedAt}}</span> (UTC)</p>',
  '{{#if footerLinks}}<nav>{{#each footerLinks}}<a href="{{url}}">{{label}}</a>{{#unless @last}} · {{/unless}}{{/each}}</nav>{{/if}}',
  '<small>© {{year}} {{shopName}}</small>',
].join('');

const base = {
  shell,
  heading: 'New withdrawal',
  intro: 'A new withdrawal has been submitted.',
  formType: 'Withdrawal',
  fields: [
    { label: 'Name', value: 'Alice Example' },
    { label: 'Order reference', value: 'ORD-42' },
    { label: 'Email address', value: 'alice@example.com' },
  ],
  submittedAt: new Date('2026-07-06T10:30:00Z'),
  locale: 'en-US',
  shopName: 'Example Shop',
  shopUrl: 'https://shop.example',
  footerLinks: [
    { label: 'Imprint', url: 'https://shop.example/imprint' },
    { label: 'Privacy', url: 'https://shop.example/privacy' },
  ],
};

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
    // One <tr> per field — the Handlebars {{#each}} loop ran, not a single JS-built blob.
    expect(html.match(/<tr>/g)).toHaveLength(base.fields.length);
    expect(html).not.toContain('{{');
  });

  it('formats submittedAt in UTC and uses English chrome labels for en', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('2026');
    expect(html).toContain('Form type');
    expect(html).toContain('Received at');
  });

  it('uses German chrome labels for a de locale', () => {
    const { html } = renderFormEmail({ ...base, locale: 'de-DE' });
    expect(html).toContain('Formulartyp');
    expect(html).toContain('Eingegangen am');
  });

  it('renders the shop-name header (linked) and a footer copyright with the shop name + year', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('<a href="https://shop.example">Example Shop</a>'); // linked header
    expect(html).toContain('© 2026 Example Shop'); // copyright, UTC year
  });

  it('renders each footer link in order, joined by a separator', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('<a href="https://shop.example/imprint">Imprint</a>');
    expect(html).toContain('<a href="https://shop.example/privacy">Privacy</a>');
    expect(html).toContain('·'); // {{#unless @last}} separator between the two links
    expect(html.indexOf('Imprint')).toBeLessThan(html.indexOf('Privacy')); // order preserved
  });

  it('omits the footer link section when no links are configured, keeping header + copyright', () => {
    const { html } = renderFormEmail({ ...base, footerLinks: undefined });
    expect(html).not.toContain('<nav>');
    expect(html).toContain('Example Shop'); // header + copyright still present
    expect(html).not.toContain('{{');
  });

  it('renders the shop name as plain text (no link) when shopUrl is omitted', () => {
    const { html } = renderFormEmail({ ...base, shopUrl: undefined });
    expect(html).toContain('<span>Example Shop</span>');
    expect(html).not.toContain('<a href="https://shop.example"');
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
