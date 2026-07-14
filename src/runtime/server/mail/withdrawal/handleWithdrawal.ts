import pRetry, { AbortError } from 'p-retry';
import { getWithdrawalStrings } from './strings';
import type { FormEmailField, RenderedEmail } from '../template/renderFormEmail';
import type { MailerConfig, MailMessage, MailTransport } from '../transport/types';

export interface WithdrawalInput {
  name: string;
  orderReference: string;
  email: string;
}

/** Renders a form email given per-request props (shell is bound by the caller). */
export type RenderEmail = (opts: {
  heading: string;
  intro: string;
  formType: string;
  fields: FormEmailField[];
  submittedAt: Date;
  locale: string;
  timeZone?: string;
  shopName: string;
  shopUrl?: string;
  footerLinks?: { label: string; url: string }[];
}) => RenderedEmail;

export interface HandleWithdrawalDeps {
  input: WithdrawalInput;
  locale: string;
  config: MailerConfig;
  transport: MailTransport;
  renderEmail: RenderEmail;
  now: () => Date;
  logger?: Pick<Console, 'error'>;
  /** Store-notice retries (default 1). */
  retries?: number;
  /** Backoff ms before a retry (default 500; tests pass 0). */
  minTimeout?: number;
}

export interface WithdrawalResult {
  success: boolean;
  message?: string;
}

/** Transient, unambiguously pre-delivery nodemailer error codes — safe to retry. */
const RETRYABLE_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS']);

function sendStoreNotice(
  transport: MailTransport,
  message: MailMessage,
  retries: number,
  minTimeout: number,
) {
  return pRetry(
    async () => {
      try {
        return await transport.send(message);
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (!code || !RETRYABLE_CODES.has(code)) {
          // Not a transient pre-delivery error — stop; retrying risks a duplicate send.
          throw new AbortError(error instanceof Error ? error : new Error(String(error)));
        }
        throw error; // retryable
      }
    },
    { retries, minTimeout, factor: 1 },
  );
}

/**
 * Formats and sends the two withdrawal emails.
 * 1. Store notice (critical) — the actual delivery of the withdrawal to the trader.
 * 2. Consumer acknowledgement (Eingangsbestätigung) — best-effort durable-medium confirmation.
 * Pure and dependency-injected; the orchestr action file wires real config/transport/clock in.
 */
export async function handleWithdrawal({
  input,
  locale,
  config,
  transport,
  renderEmail,
  now,
  logger = console,
  retries = 1,
  minTimeout = 500,
}: HandleWithdrawalDeps): Promise<WithdrawalResult> {
  const submittedAt = now();
  const strings = getWithdrawalStrings(locale);
  const fields: FormEmailField[] = [
    { label: strings.fieldLabels.name, value: input.name },
    { label: strings.fieldLabels.orderReference, value: input.orderReference },
    { label: strings.fieldLabels.email, value: input.email },
  ];
  // Shop branding — identical header/footer on both emails.
  const brand = {
    shopName: config.brand.shopName,
    shopUrl: config.brand.shopUrl,
    footerLinks: config.brand.footerLinks,
  };

  // 1. Store notice — critical.
  const storeBody = renderEmail({
    heading: strings.storeNotice.heading,
    intro: strings.storeNotice.intro,
    formType: strings.formType,
    fields,
    submittedAt,
    locale,
    timeZone: config.timeZone,
    ...brand,
  });
  const storeMessage: MailMessage = {
    from: config.from,
    to: config.recipient,
    replyTo: config.replyToConsumer === false ? undefined : input.email,
    subject: strings.subjectStoreNotice,
    html: storeBody.html,
    text: storeBody.text,
  };
  try {
    await sendStoreNotice(transport, storeMessage, retries, minTimeout);
  } catch (error) {
    logger.error('[essentials-mailer] withdrawal store notice failed', error);
    return { success: false, message: strings.errors.deliveryFailed };
  }

  // 2. Consumer acknowledgement — best-effort; failure must not fail the withdrawal.
  const ackBody = renderEmail({
    heading: strings.consumerAck.heading,
    intro: strings.consumerAck.intro,
    formType: strings.formType,
    fields,
    submittedAt,
    locale,
    timeZone: config.timeZone,
    ...brand,
  });
  const ackMessage: MailMessage = {
    from: config.from,
    to: input.email,
    subject: strings.subjectConsumerAck,
    html: ackBody.html,
    text: ackBody.text,
  };
  try {
    await transport.send(ackMessage);
  } catch (error) {
    logger.error('[essentials-mailer] withdrawal consumer acknowledgement failed', error);
  }

  return { success: true };
}
