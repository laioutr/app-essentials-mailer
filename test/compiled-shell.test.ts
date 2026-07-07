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
    ]) {
      expect(formEmailShell).toContain(token);
    }
  });

  it('preserves the Handlebars fields loop (runtime {{#each}}, not a build-time Vue v-for)', () => {
    for (const token of ['{{#each fields}}', '{{label}}', '{{value}}', '{{/each}}']) {
      expect(formEmailShell).toContain(token);
    }
  });

  it('has inlined styles (Maizzle CSS inlining ran)', () => {
    expect(formEmailShell).toMatch(/style="/);
  });
});
