import { describe, expect, it, vi } from 'vitest';
import {
  channelsBodyOf,
  channelsLocaleOf,
  type ChannelsTarget,
  channelsTargetOf,
  DEFAULT_CHANNELS_URL,
  submitToChannels,
} from '../src/runtime/server/mail/channels';

const project = { projectSlug: 'acme/shop', projectSecretKey: 'secret' };
const target: ChannelsTarget = {
  url: 'https://cockpit.example.test/api/channel-email/submissions',
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
});

describe('submitToChannels', () => {
  it('is sent when the Cockpit took it', async () => {
    const fetchFn = answering(200, { success: true });
    await expect(submitToChannels(target, withdrawal, fetchFn)).resolves.toEqual({ kind: 'sent' });
    expect(fetchFn).toHaveBeenCalledWith(target.url, expect.objectContaining({ method: 'POST', redirect: 'error' }));
  });

  it('passes the quota on to the visitor and never falls back to own mail', async () => {
    const outcome = await submitToChannels(
      target,
      withdrawal,
      answering(429, { success: false, code: 'limitReached', message: 'Bitte kontaktieren Sie den Shop.' }),
    );
    expect(outcome).toEqual({ kind: 'refused', message: 'Bitte kontaktieren Sie den Shop.', limitReached: true });
  });

  it('passes on a bot or flood refusal as final', async () => {
    const outcome = await submitToChannels(target, withdrawal, answering(403, { success: false, message: 'No.' }));
    expect(outcome).toEqual({ kind: 'refused', message: 'No.', limitReached: false });
  });

  it('leaves it to own mail where the channel is not set up, the project unknown, or the Cockpit fails', async () => {
    for (const [status, body] of [
      [503, { success: false, code: 'channelNotSetUp' }],
      [401, { success: false, message: 'x' }],
      [500, { success: false, message: 'x' }],
      [502, undefined],
    ] as const) {
      const outcome = await submitToChannels(target, withdrawal, answering(status, body));
      expect(outcome.kind).toBe('unavailable');
    }
  });

  it('leaves it to own mail when the Cockpit cannot be reached', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(submitToChannels(target, withdrawal, fetchFn)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'fetch failed',
    });
  });
});
