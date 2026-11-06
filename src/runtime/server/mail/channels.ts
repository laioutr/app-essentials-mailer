import { createHash } from 'node:crypto';
import type { ClientAddressSource } from '../../../config-types';

/**
 * Delivery through the project's Email channel in Laioutr: the submission is posted to the Channels service, which
 * proves the storefront, stores it and answers "received"; the Cockpit then sends the store notice and the visitor's
 * email from the project's address or its own mailbox, logs them and counts them against the project's quota. No Nuxt
 * imports, so it is tested on its own.
 */

/** Who the storefront is, as the Channels service proves it. Never leaves the server. */
export interface ChannelsIdentity {
  projectSlug: string;
  projectSecret: string;
  environmentName: string;
}

export interface ChannelsTarget {
  url: string;
  identity: ChannelsIdentity;
  /** `local` for a dev server, so a local run of a production config never mails real people or uses the quota. */
  environmentType?: 'local';
}

export const DEFAULT_CHANNELS_URL = 'https://api.laioutr.cloud/channels/v1/submissions';

/**
 * Read at runtime as well as at build: the app's runtime-config key holds `@` and `/`, which no shell variable name can
 * carry, so Nitro's own `NUXT_…` overlay cannot reach it.
 */
export const CHANNELS_URL_ENV = 'NUXT_LAIOUTR_MAILER_CHANNELS_URL';

export const DEFAULT_ENVIRONMENT_NAME = 'main';

/** The service only stores the submission; past this the storefront's own mail takes it. */
const CHANNELS_TIMEOUT_MS = 10_000;

/** The target, or null where the storefront is not a Laioutr project (a playground, no secret) or Channels is off. */
export function channelsTargetOf(config: {
  enabled?: boolean;
  url?: string;
  projectSlug?: string;
  projectSecretKey?: string;
  environmentName?: string;
  dev?: boolean;
}): ChannelsTarget | null {
  if (config.enabled === false) return null;
  const projectSlug = config.projectSlug?.trim();
  const projectSecret = config.projectSecretKey?.trim();
  if (!projectSlug || !projectSlug.includes('/') || !projectSecret) return null;
  return {
    url: config.url?.trim() || DEFAULT_CHANNELS_URL,
    identity: { projectSlug, projectSecret, environmentName: config.environmentName?.trim() || DEFAULT_ENVIRONMENT_NAME },
    ...(config.dev ? { environmentType: 'local' as const } : {}),
  };
}

/** The Cockpit writes its emails in these locales; any other is written in English. */
export const channelsLocaleOf = (locale: string | undefined): 'de' | 'en' =>
  locale?.trim().toLowerCase().startsWith('de') ? 'de' : 'en';

export interface ChannelsSubmission {
  form: { id: string; name: string };
  purpose: 'form' | 'withdrawal';
  fields: Record<string, string>;
  visitorEmail?: string;
  locale: string;
  /** The visitor's connection, as {@link clientKeyOf} hides it: the service limits submissions per key. */
  clientKey?: string;
}

/**
 * The visitor's address from the header a trusted proxy sets, or undefined where none can be trusted — then the service
 * applies no per-sender limit rather than one key for every visitor behind the same proxy.
 * - `cloudflare`: Cloudflare overwrites `cf-connecting-ip` on every request it proxies.
 * - `forwarded`: the first `x-forwarded-for` entry, for a proxy that overwrites the header (Vercel does).
 * - `auto`: `forwarded` on Vercel, `cloudflare` where the request came through Cloudflare (`cf-ray`), else none.
 */
export const visitorAddressOf = (
  header: (name: string) => string | undefined,
  source: ClientAddressSource = 'auto',
  onVercel = false,
): string | undefined => {
  const fromCloudflare = () => header('cf-connecting-ip')?.trim() || undefined;
  const forwarded = () => header('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  if (source === 'cloudflare') return fromCloudflare();
  if (source === 'forwarded') return forwarded();
  if (source === 'none') return undefined;
  if (onVercel) return forwarded();
  return header('cf-ray') ? fromCloudflare() : undefined;
};

/**
 * The hex SHA-256 of the visitor's address as the request gives it, so the service can tell one sender from another
 * without receiving the address itself. Undefined where no address is known: the service then applies no per-sender
 * limit.
 */
export const clientKeyOf = (ip: string | undefined): string | undefined => {
  const address = ip?.trim();
  return address ? createHash('sha256').update(address).digest('hex') : undefined;
};

/**
 * How the Channels service answered:
 * - `received` — it stored the submission; the Cockpit sends it, or holds it at the project's quota, within the minute;
 * - `refused` — a final answer: a malformed submission (400), refused (403) or too many submissions (429). The
 *   storefront's own mail never stands in for it;
 * - `unavailable` — the service did not know the storefront (401: the project unknown or its secret wrong, which a
 *   stale identity at the service answers too), failed (5xx), could not be reached or did not answer in time: nothing
 *   is known to be stored, so the storefront's own mail takes it, and a withdrawal is never lost to an identity the
 *   service has not caught up with.
 */
export type ChannelsOutcome =
  | { kind: 'received' }
  | { kind: 'refused'; status: number }
  | { kind: 'unavailable'; reason: string };

/** Answers after which the storefront's own mail would only repeat or bypass the service's decision. */
const FINAL_REFUSALS = new Set([400, 403, 429]);

export const channelsBodyOf = (target: ChannelsTarget, submission: ChannelsSubmission) => ({
  ...target.identity,
  ...(target.environmentType ? { environmentType: target.environmentType } : {}),
  form: submission.form,
  purpose: submission.purpose,
  fields: submission.fields,
  ...(submission.visitorEmail ? { visitorEmail: submission.visitorEmail } : {}),
  locale: channelsLocaleOf(submission.locale),
  ...(submission.clientKey ? { clientKey: submission.clientKey } : {}),
});

/** What the service's error says, for the log only: `{ error }`. */
const errorOf = async (response: Response): Promise<string | undefined> => {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body?.error === 'string' ? body.error : undefined;
  } catch {
    return undefined;
  }
};

export async function submitToChannels(
  target: ChannelsTarget,
  submission: ChannelsSubmission,
  fetchFn: typeof fetch = fetch,
): Promise<ChannelsOutcome> {
  let response: Response;
  try {
    response = await fetchFn(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(channelsBodyOf(target, submission)),
      redirect: 'error',
      signal: AbortSignal.timeout(CHANNELS_TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: 'unavailable', reason: error instanceof Error ? error.message : 'request failed' };
  }
  if (response.ok) return { kind: 'received' };
  if (FINAL_REFUSALS.has(response.status)) return { kind: 'refused', status: response.status };
  const error = await errorOf(response);
  return { kind: 'unavailable', reason: `${response.status}${error ? ` ${error}` : ''}` };
}
