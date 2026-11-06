import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsTarget } from '../src/runtime/server/mail/channels';
import { getWithdrawalStrings } from '../src/runtime/server/mail/withdrawal/strings';

const mailer = vi.hoisted(() => ({ headers: {} as Record<string, string>, sendMail: vi.fn() }));

const target: ChannelsTarget = {
  url: 'https://api.example.test/channels/v1/submissions',
  identity: { projectSlug: 'acme/shop', projectSecret: 'secret', environmentName: 'main' },
};

vi.mock('#imports', () => ({
  getRequestHeader: (_event: unknown, name: string) => mailer.headers[name],
  useMailer: () => ({
    channels: target,
    sendMail: mailer.sendMail,
    ctx: { locale: 'de-DE', shopName: 'Shop' },
    config: { from: 'Shop <noreply@example.test>', recipient: 'legal@example.test' },
  }),
}));
vi.mock('../src/runtime/server/middleware', () => ({
  defineEssentialsMailerAction: (_token: unknown, handler: unknown) => handler,
}));

type Handler = (args: { input: unknown; clientEnv: { locale: string }; event: unknown }) => Promise<unknown>;
const { default: withdraw } = (await import('../src/runtime/server/orchestr/legal/withdrawal.action')) as unknown as {
  default: Handler;
};

const input = { name: 'Jane Doe', orderReference: 'ORD-1', email: 'jane@example.test' };
const submit = () => withdraw({ input, clientEnv: { locale: 'de-DE' }, event: {} });

const answering = (status: number) => vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status }));
const posted = (fetchFn: ReturnType<typeof answering>) =>
  JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

beforeEach(() => {
  mailer.headers = {};
  mailer.sendMail.mockReset().mockResolvedValue({ messageId: 'm' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('withdrawal through the Email channel', () => {
  it('is received by the service, and own mail sends nothing', async () => {
    vi.stubGlobal('fetch', answering(202));
    await expect(submit()).resolves.toEqual({ success: true });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('falls back to own mail when the service does not know the storefront (401), so it is never lost', async () => {
    vi.stubGlobal('fetch', answering(401));
    await expect(submit()).resolves.toEqual({ success: true });
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'legal@example.test' }), expect.anything());
  });

  it.each([400, 403, 429])('answers a %i with the Mailer’s own error and sends no own mail', async (status) => {
    vi.stubGlobal('fetch', answering(status));
    await expect(submit()).resolves.toEqual({
      success: false,
      message: getWithdrawalStrings('de-DE').errors.deliveryFailed,
    });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('sends the hash of the visitor’s address as the client key, never the address', async () => {
    mailer.headers = { 'cf-ray': '8f0a-FRA', 'cf-connecting-ip': '203.0.113.7' };
    const fetchFn = answering(202);
    vi.stubGlobal('fetch', fetchFn);
    await submit();
    const body = posted(fetchFn);
    expect(body.clientKey).toBe(createHash('sha256').update('203.0.113.7').digest('hex'));
    expect(JSON.stringify(body)).not.toContain('203.0.113.7');
  });

  it('sends no client key where the request gives no address', async () => {
    const fetchFn = answering(202);
    vi.stubGlobal('fetch', fetchFn);
    await submit();
    expect(posted(fetchFn)).not.toHaveProperty('clientKey');
  });
});
