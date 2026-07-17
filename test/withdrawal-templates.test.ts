import { describe, expect, it } from 'vitest';
import type { MailRenderContext } from '../src/runtime/server/mail/template/types';
import {
  renderWithdrawalAck,
  renderWithdrawalStoreNotice,
  type WithdrawalVars,
} from '../src/runtime/server/mail/withdrawal/templates';

const ctx = (locale: string): MailRenderContext => ({ locale, shopName: 'Example Shop' });

const vars: WithdrawalVars = {
  name: 'Alice Example',
  orderReference: 'ORD-42',
  email: 'alice@example.com',
  submittedAt: new Date('2026-07-06T10:30:00Z'),
};

describe('withdrawal templates', () => {
  it('store notice: English subject + heading/intro + all fields + shopName in the body', () => {
    const { subject, html, text } = renderWithdrawalStoreNotice(ctx('en-US'), vars);
    expect(subject).toBe('New withdrawal received');
    expect(html).toContain('New withdrawal');
    expect(html).toContain('A new withdrawal has been submitted');
    expect(html).toContain('Alice Example');
    expect(html).toContain('ORD-42');
    expect(html).toContain('alice@example.com');
    expect(html).toContain('Example Shop'); // ctx threads through
    expect(html).not.toContain('{{');
    expect(text).toContain('Alice Example');
  });

  it('consumer ack: English subject + heading + intro', () => {
    const { subject, html } = renderWithdrawalAck(ctx('en-US'), vars);
    expect(subject).toBe('Confirmation of your withdrawal');
    expect(html).toContain('Confirmation of your withdrawal');
    expect(html).toContain('We confirm receipt of your withdrawal');
  });

  it('localizes subject + field labels for a German locale', () => {
    const { subject, html } = renderWithdrawalStoreNotice(ctx('de-DE'), vars);
    expect(subject).toBe('Neuer Widerruf eingegangen');
    expect(html).toContain('Bestellnummer');
    expect(html).toContain('E-Mail-Adresse');
  });
});
