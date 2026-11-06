/**
 * Delivery through the project's Email channel in the Laioutr Cockpit: the Cockpit sends the store notice and the
 * visitor's email from the project's address or its own mailbox, logs them and counts them against the project's
 * quota. No Nuxt imports, so it is tested on its own.
 */

/** Who the storefront is, as the Cockpit identifies it. Never leaves the server. */
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

export const DEFAULT_CHANNELS_URL = 'https://cockpit.laioutr.cloud/api/channel-email/submissions';

/**
 * Read at runtime as well as at build: the app's runtime-config key holds `@` and `/`, which no shell variable name can
 * carry, so Nitro's own `NUXT_…` overlay cannot reach it.
 */
export const CHANNELS_URL_ENV = 'NUXT_LAIOUTR_MAILER_CHANNELS_URL';

export const DEFAULT_ENVIRONMENT_NAME = 'main';

/** The Cockpit refuses a hung request's place to nobody: past this the storefront's own mail takes the submission. */
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

/** The Cockpit writes its emails in these locales; any other is answered in English. */
export const channelsLocaleOf = (locale: string | undefined): 'de' | 'en' =>
  locale?.trim().toLowerCase().startsWith('de') ? 'de' : 'en';

export interface ChannelsSubmission {
  form: { id: string; name: string };
  purpose: 'form' | 'withdrawal';
  fields: Record<string, string>;
  visitorEmail?: string;
  locale: string;
}

/**
 * How the Cockpit answered:
 * - `sent` — the team has it, and the visitor's email went where one goes;
 * - `refused` — a final answer the visitor reads (the project's monthly quota, too many submissions, a bot, a malformed
 *   one); the storefront's own mail never stands in for it, so a quota stays a quota;
 * - `unavailable` — the channel is not set up for this project, the Mailer is not installed in the Cockpit, or the
 *   Cockpit could not be reached or failed; nothing is known to have been sent, so the storefront's own mail takes it.
 */
export type ChannelsOutcome =
  | { kind: 'sent' }
  | { kind: 'refused'; message: string; limitReached: boolean }
  | { kind: 'unavailable'; reason: string };

/** Answers after which the storefront's own mail would only repeat or bypass the Cockpit's decision. */
const FINAL_REFUSALS = new Set([400, 403, 429]);

export const channelsBodyOf = (target: ChannelsTarget, submission: ChannelsSubmission) => ({
  ...target.identity,
  ...(target.environmentType ? { environmentType: target.environmentType } : {}),
  form: submission.form,
  purpose: submission.purpose,
  fields: submission.fields,
  ...(submission.visitorEmail ? { visitorEmail: submission.visitorEmail } : {}),
  locale: channelsLocaleOf(submission.locale),
});

const answerOf = async (response: Response): Promise<{ message?: string; code?: string }> => {
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown };
    return {
      message: typeof body?.message === 'string' ? body.message : undefined,
      code: typeof body?.code === 'string' ? body.code : undefined,
    };
  } catch {
    return {};
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
  if (response.ok) return { kind: 'sent' };
  const answer = await answerOf(response);
  if (FINAL_REFUSALS.has(response.status) && answer.message)
    return { kind: 'refused', message: answer.message, limitReached: answer.code === 'limitReached' };
  return { kind: 'unavailable', reason: `${response.status}${answer.code ? ` ${answer.code}` : ''}` };
}
