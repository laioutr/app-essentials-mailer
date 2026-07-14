import { describe, expect, it, vi } from 'vitest';
import type { MailMessage, MailTransport, SendResult } from '../src/runtime/server/mail/transport/types';
import { handleWithdrawal } from '../src/runtime/server/mail/withdrawal/handleWithdrawal';

const input = { name: 'Alice', orderReference: 'ORD-42', email: 'alice@example.com' };
const cfg = (o = {}) => ({
  transport: { type: 'smtp' as const, host: 'h', port: 587, auth: { user: 'u', pass: 'p' } },
  from: 'Shop <noreply@example.com>',
  recipient: 'trader@example.com',
  replyToConsumer: true,
  brand: { shopName: 'Test Shop' },
  ...o,
});
// Fake renderer — no shell/Maizzle needed.
const renderEmail = (o: { heading: string }) => ({ html: `<h1>${o.heading}</h1>`, text: o.heading });
const now = () => new Date('2026-07-06T10:30:00Z');
const err = (code: string) => Object.assign(new Error(code), { code });

function recorder(fail?: (m: MailMessage) => Error | undefined) {
  const sent: MailMessage[] = [];
  const transport: MailTransport = {
    async send(m): Promise<SendResult> {
      sent.push(m);
      const e = fail?.(m);
      if (e) throw e;
      return { messageId: `id-${sent.length}` };
    },
  };
  return { transport, sent };
}

describe('handleWithdrawal', () => {
  it('sends store notice first (reply-to consumer), then consumer ack, returns success', async () => {
    const { transport, sent } = recorder();
    const r = await handleWithdrawal({ input, locale: 'de-DE', config: cfg(), transport, renderEmail, now });
    expect(r).toEqual({ success: true });
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBe('trader@example.com');
    expect(sent[0].replyTo).toBe('alice@example.com');
    expect(sent[1].to).toBe('alice@example.com');
    expect(sent[1].replyTo).toBeUndefined();
  });

  it('omits store-notice reply-to when replyToConsumer is false', async () => {
    const { transport, sent } = recorder();
    await handleWithdrawal({
      input,
      locale: 'en-US',
      config: cfg({ replyToConsumer: false }),
      transport,
      renderEmail,
      now,
    });
    expect(sent[0].replyTo).toBeUndefined();
  });

  it('retries the store notice once on a transient ECONNECTION and then succeeds', async () => {
    let n = 0;
    const transport: MailTransport = {
      async send(m) {
        if (m.to === 'trader@example.com') {
          n++;
          if (n === 1) throw err('ECONNECTION');
        }
        return { messageId: 'ok' };
      },
    };
    const r = await handleWithdrawal({ input, locale: 'en-US', config: cfg(), transport, renderEmail, now, minTimeout: 0 });
    expect(r).toEqual({ success: true });
    expect(n).toBe(2);
  });

  it('does NOT retry a non-transient error (EENVELOPE), returns success:false, sends no consumer ack', async () => {
    const logger = { error: vi.fn() };
    const { transport, sent } = recorder((m) => (m.to === 'trader@example.com' ? err('EENVELOPE') : undefined));
    const r = await handleWithdrawal({ input, locale: 'en-US', config: cfg(), transport, renderEmail, now, minTimeout: 0, logger });
    expect(r.success).toBe(false);
    expect(r.message).toContain('could not be submitted');
    expect(sent.filter((m) => m.to === 'trader@example.com')).toHaveLength(1); // aborted, no retry
    expect(sent.some((m) => m.to === 'alice@example.com')).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('passes the configured timezone to both rendered messages', async () => {
    const { transport } = recorder();
    const render = vi.fn(renderEmail);

    await handleWithdrawal({
      input,
      locale: 'de-DE',
      config: cfg({ timeZone: 'Europe/Berlin' }),
      transport,
      renderEmail: render,
      now,
    });

    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ timeZone: 'Europe/Berlin' }),
    );
    expect(render).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ timeZone: 'Europe/Berlin' }),
    );
  });

  it('still returns success when the consumer ack fails (best-effort), logging it', async () => {
    const logger = { error: vi.fn() };
    const { transport } = recorder((m) => (m.to === 'alice@example.com' ? err('ECONNECTION') : undefined));
    const r = await handleWithdrawal({ input, locale: 'en-US', config: cfg(), transport, renderEmail, now, minTimeout: 0, logger });
    expect(r).toEqual({ success: true });
    expect(logger.error).toHaveBeenCalled();
  });
});
