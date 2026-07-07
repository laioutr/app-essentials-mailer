import { describe, expect, it } from 'vitest';
import { getWithdrawalStrings } from '../src/runtime/server/mail/withdrawal/strings';

describe('getWithdrawalStrings', () => {
  it('German for de', () => {
    const s = getWithdrawalStrings('de-DE');
    expect(s.formType).toBe('Widerruf');
    expect(s.fieldLabels.orderReference).toBe('Bestellnummer');
  });
  it('English for en', () => {
    const s = getWithdrawalStrings('en-US');
    expect(s.formType).toBe('Withdrawal');
    expect(s.fieldLabels.orderReference).toBe('Order reference');
  });
  it('English fallback for unknown locale', () => {
    expect(getWithdrawalStrings('fr-FR').formType).toBe('Withdrawal');
  });
});
