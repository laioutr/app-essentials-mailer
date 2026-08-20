import { describe, expect, it } from 'vitest';
import type { MailerConfig, WithdrawalActionConfig } from '../src/config-types';
import { resolveWithdrawalSettings } from '../src/runtime/server/mail/withdrawal/settings';

const base: MailerConfig = {
  transport: { type: 'smtp', host: 'localhost', port: 1025, auth: { user: 'u', pass: 'p' } },
  from: 'Shop <noreply@example.com>',
  recipient: 'legal@example.com',
  brand: { shopName: 'Example Shop' },
};

const withAction = (withdrawal: WithdrawalActionConfig): MailerConfig => ({
  ...base,
  actions: { withdrawal },
});

describe('resolveWithdrawalSettings', () => {
  it('falls back to the global defaults and enables both toggles with no action block', () => {
    expect(resolveWithdrawalSettings(base)).toEqual({
      from: 'Shop <noreply@example.com>',
      recipient: 'legal@example.com',
      replyToConsumer: true,
      consumerAck: true,
    });
  });

  it('overrides each addressing field independently', () => {
    expect(resolveWithdrawalSettings(withAction({ recipient: 'widerruf@example.com' }))).toMatchObject({
      from: 'Shop <noreply@example.com>',
      recipient: 'widerruf@example.com',
    });
    expect(resolveWithdrawalSettings(withAction({ from: 'Legal <legal@example.com>' }))).toMatchObject({
      from: 'Legal <legal@example.com>',
      recipient: 'legal@example.com',
    });
  });

  it('lets the action override replyToConsumer in both directions', () => {
    const disabled = { ...base, replyToConsumer: true, actions: { withdrawal: { replyToConsumer: false } } };
    const enabled = { ...base, replyToConsumer: false, actions: { withdrawal: { replyToConsumer: true } } };
    expect(resolveWithdrawalSettings(disabled).replyToConsumer).toBe(false);
    expect(resolveWithdrawalSettings(enabled).replyToConsumer).toBe(true);
  });

  it('disables replyToConsumer only on an explicit false', () => {
    expect(resolveWithdrawalSettings({ ...base, replyToConsumer: false }).replyToConsumer).toBe(false);
    // The config is unvalidated: a falsy non-boolean is not `false` and must keep the header,
    // exactly as the pre-existing `=== false` check did. Pins the contract against `?? true`.
    const malformed = { ...base, replyToConsumer: 0 as unknown as boolean };
    expect(resolveWithdrawalSettings(malformed).replyToConsumer).toBe(true);
  });

  it('sends the consumer acknowledgement unless it is explicitly false', () => {
    expect(resolveWithdrawalSettings(withAction({})).consumerAck).toBe(true);
    expect(resolveWithdrawalSettings(withAction({ consumerAck: true })).consumerAck).toBe(true);
    expect(resolveWithdrawalSettings(withAction({ consumerAck: false })).consumerAck).toBe(false);
  });
});
