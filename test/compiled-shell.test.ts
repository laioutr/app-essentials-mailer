import { describe, expect, it } from 'vitest';
import { formEmailShell } from '../src/runtime/emails/compiled/form-email';

describe('compiled form-email shell', () => {
  it('preserves every runtime scalar placeholder', () => {
    for (const token of [
      '{{heading}}',
      '{{intro}}',
      '{{formType}}',
      '{{formTypeLabel}}',
      '{{submittedAt}}',
      '{{submittedAtLabel}}',
      '{{htmlLang}}',
      '{{textDirection}}',
      '{{timeZone}}',
    ]) {
      expect(formEmailShell).toContain(token);
    }
  });

  it('preserves the Handlebars fields loop (runtime {{#each}}, not a build-time Vue v-for)', () => {
    for (const token of ['{{#each fields}}', '{{label}}', '{{value}}', '{{/each}}']) {
      expect(formEmailShell).toContain(token);
    }
  });

  it('preserves the brand header/footer tokens (runtime {{#if}} / {{#each footerLinks}})', () => {
    for (const token of [
      '{{shopName}}',
      '{{#if shopUrl}}',
      'href="{{shopUrl}}"',
      '{{#if footerLinks}}',
      '{{#each footerLinks}}',
      'href="{{url}}"',
      '{{#unless @last}}',
      '{{year}}',
    ]) {
      expect(formEmailShell).toContain(token);
    }
  });

  it('preserves runtime language and direction metadata in every Maizzle wrapper', () => {
    expect(formEmailShell).toContain(
      '<html lang="{{htmlLang}}" dir="{{textDirection}}"',
    );
    expect(formEmailShell).toContain(
      '<body xml:lang="{{htmlLang}}" dir="{{textDirection}}"',
    );
    expect(formEmailShell).toContain(
      'role="article" aria-roledescription="email" lang="{{htmlLang}}" dir="{{textDirection}}"',
    );
  });

  it('has inlined styles (Maizzle CSS inlining ran)', () => {
    expect(formEmailShell).toMatch(/style="/);
  });
});
