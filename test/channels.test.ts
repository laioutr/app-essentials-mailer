import { describe, expect, it, vi } from 'vitest';
import {
  channelsBodyOf,
  channelsLocaleOf,
  type ChannelsTarget,
  channelsTargetOf,
  clientKeyOf,
  DEFAULT_CHANNELS_URL,
  submitToChannels,
  visitorAddressOf,
} from '../src/runtime/server/mail/channels';

const project = { projectSlug: 'acme/shop', projectSecretKey: 'secret' };
const target: ChannelsTarget = {
  url: 'https://api.example.test/channels/v1/submissions',
  identity: { projectSlug: 'acme/shop', projectSecret: 'secret', environmentName: 'main' },
};
const withdrawal = {
  form: { id: 'withdrawal', name: 'Withdrawal' },
  purpose: 'withdrawal' as const,
  fields: { name: 'Jane Doe', orderReference: 'ORD-1' },
  visitorEmail: 'jane@example.test',
  locale: 'de-DE',
};

const answering = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

describe('channelsTargetOf', () => {
  it('targets the Cockpit for a Laioutr project, on main by default', () => {
    expect(channelsTargetOf(project)).toEqual({
      url: DEFAULT_CHANNELS_URL,
      identity: { projectSlug: 'acme/shop', projectSecret: 'secret', environmentName: 'main' },
    });
  });

  it('is off where the storefront is no Laioutr project or Channels is switched off', () => {
    expect(channelsTargetOf({ projectSlug: 'acme/shop', projectSecretKey: ' ' })).toBeNull();
    expect(channelsTargetOf({ projectSlug: 'shop', projectSecretKey: 'secret' })).toBeNull();
    expect(channelsTargetOf({ ...project, enabled: false })).toBeNull();
  });

  it('marks a dev server as local, so it never mails real people', () => {
    expect(channelsTargetOf({ ...project, dev: true })?.environmentType).toBe('local');
  });
});

describe('channelsBodyOf', () => {
  it('sends the identity, the submission and a locale the Cockpit writes in', () => {
    expect(channelsBodyOf(target, withdrawal)).toEqual({
      projectSlug: 'acme/shop',
      projectSecret: 'secret',
      environmentName: 'main',
      form: { id: 'withdrawal', name: 'Withdrawal' },
      purpose: 'withdrawal',
      fields: { name: 'Jane Doe', orderReference: 'ORD-1' },
      visitorEmail: 'jane@example.test',
      locale: 'de',
    });
    expect(channelsLocaleOf('fr')).toBe('en');
  });

  it('carries the client key where one is known', () => {
    expect(channelsBodyOf(target, { ...withdrawal, clientKey: 'abc' })).toMatchObject({ clientKey: 'abc' });
  });
});

describe('clientKeyOf', () => {
  it('is the hex SHA-256 of the address, never the address', () => {
    expect(clientKeyOf('203.0.113.7')).toBe('fec52565aa0cf18f57d7cf5b3ac728503b8992d2d6f7d46da1d1201090902b02');
    expect(clientKeyOf('203.0.113.7')).not.toBe(clientKeyOf('203.0.113.8'));
  });

  it('is absent where no address is known', () => {
    expect(clientKeyOf(undefined)).toBeUndefined();
    expect(clientKeyOf(' ')).toBeUndefined();
  });
});

describe('submitToChannels', () => {
  it('posts to the Channels service by default', () => {
    expect(DEFAULT_CHANNELS_URL).toBe('https://api.laioutr.cloud/channels/v1/submissions');
  });

  it('is received when the service stored it', async () => {
    const fetchFn = answering(202, { received: true });
    await expect(submitToChannels(target, withdrawal, fetchFn)).resolves.toEqual({ kind: 'received' });
    expect(fetchFn).toHaveBeenCalledWith(target.url, expect.objectContaining({ method: 'POST', redirect: 'error' }));
  });

  it.each([400, 403, 429])('takes a %i as final and never falls back to own mail', async (status) => {
    const outcome = await submitToChannels(target, withdrawal, answering(status, { error: 'refused' }));
    expect(outcome).toEqual({ kind: 'refused', status });
  });

  it('leaves it to own mail where the service does not know the storefront or fails', async () => {
    for (const [status, body] of [
      [401, { error: 'unauthorized' }],
      [500, { error: 'internal server error' }],
      [503, { error: 'unavailable' }],
      [502, undefined],
    ] as const) {
      const outcome = await submitToChannels(target, withdrawal, answering(status, body));
      expect(outcome.kind).toBe('unavailable');
    }
  });

  it('leaves it to own mail when the service cannot be reached or does not answer in time', async () => {
    const unreachable = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(submitToChannels(target, withdrawal, unreachable)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'fetch failed',
    });
    const timedOut = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    await expect(submitToChannels(target, withdrawal, timedOut)).resolves.toMatchObject({ kind: 'unavailable' });
  });
});

describe('visitorAddressOf', () => {
  const headers = (values: Record<string, string>) => (name: string) => values[name];
  const spoofed = { 'x-forwarded-for': '198.51.100.9, 203.0.113.7', 'cf-connecting-ip': '198.51.100.9' };

  it('trusts Cloudflare’s header only where the request came through Cloudflare', () => {
    expect(visitorAddressOf(headers({ ...spoofed, 'cf-ray': '8f0a-FRA', 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(visitorAddressOf(headers(spoofed))).toBeUndefined();
  });

  it('reads the forwarded address on Vercel, which overwrites it', () => {
    expect(visitorAddressOf(headers({ 'x-forwarded-for': '203.0.113.7' }), 'auto', true)).toBe('203.0.113.7');
  });

  it('follows the configured source', () => {
    expect(visitorAddressOf(headers(spoofed), 'forwarded')).toBe('198.51.100.9');
    expect(visitorAddressOf(headers({ 'cf-connecting-ip': '203.0.113.7' }), 'cloudflare')).toBe('203.0.113.7');
    expect(visitorAddressOf(headers({ 'cf-ray': 'x', 'cf-connecting-ip': '203.0.113.7' }), 'none')).toBeUndefined();
  });
});
