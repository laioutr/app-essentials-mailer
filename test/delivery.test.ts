import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMail } from '../src/runtime/server/mail/delivery';
import type { MailMessage, MailTransport, SendResult } from '../src/runtime/server/mail/transport/types';

const message: MailMessage = {
  from: 'Shop <noreply@example.com>',
  to: 'trader@example.com',
  subject: 'Test',
  html: '<p>hi</p>',
  text: 'hi',
};

const err = (code: string) => Object.assign(new Error(code), { code });

/** Transport whose send() runs per-attempt behavior; records the attempt count. */
function transportOf(behavior: (attempt: number) => Promise<SendResult>): {
  transport: MailTransport;
  attempts: () => number;
} {
  let n = 0;
  return {
    transport: {
      send: () => {
        n += 1;
        return behavior(n);
      },
    },
    attempts: () => n,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sendMail (delivery)', () => {
  it('retries once on a transient code then succeeds', async () => {
    vi.useFakeTimers();
    const { transport, attempts } = transportOf(async (n) => {
      if (n === 1) throw err('ECONNECTION');
      return { messageId: 'ok' };
    });
    const promise = sendMail(transport, message, { retries: 1 });
    await vi.advanceTimersByTimeAsync(600); // cross the internal 500 ms backoff
    await expect(promise).resolves.toEqual({ messageId: 'ok' });
    expect(attempts()).toBe(2);
  });

  it('aborts (no retry) on a non-transient code', async () => {
    const { transport, attempts } = transportOf(async () => {
      throw err('EENVELOPE');
    });
    await expect(sendMail(transport, message, { retries: 3 })).rejects.toThrow('EENVELOPE');
    expect(attempts()).toBe(1);
  });

  it('makes a single attempt when retries defaults to 0', async () => {
    const { transport, attempts } = transportOf(async () => {
      throw err('ECONNECTION');
    });
    await expect(sendMail(transport, message)).rejects.toThrow('ECONNECTION');
    expect(attempts()).toBe(1);
  });

  it('times out a hung attempt and does not retry it', async () => {
    const { transport, attempts } = transportOf(() => new Promise<SendResult>(() => {}));
    await expect(sendMail(transport, message, { retries: 2, timeout: 20 })).rejects.toThrow();
    expect(attempts()).toBe(1);
  });

  it('passes the message through to the transport unchanged', async () => {
    let received: MailMessage | undefined;
    const transport: MailTransport = {
      async send(m) {
        received = m;
        return { messageId: 'ok' };
      },
    };
    await sendMail(transport, message);
    expect(received).toEqual(message);
  });
});
