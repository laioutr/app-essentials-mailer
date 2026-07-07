import { describe, expect, it } from 'vitest';
import { formEmailShell } from '../src/runtime/emails/compiled/form-email';

describe('compiled form-email shell', () => {
  it('preserves every runtime placeholder', () => {
    for (const token of [
      '{{heading}}',
      '{{intro}}',
      '{{formType}}',
      '{{formTypeLabel}}',
      '{{submittedAt}}',
      '{{submittedAtLabel}}',
      '{{{fields}}}',
    ]) {
      expect(formEmailShell).toContain(token);
    }
  });

  it('has inlined styles (Maizzle CSS inlining ran)', () => {
    expect(formEmailShell).toMatch(/style="/);
  });
});
