import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import type { MailMessage, MailTransport, SendResult } from './transport/types';

/** Per-attempt timeout default (ms). Bounds a hung send; does not enable another attempt. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Constant backoff before a retry (ms). Internal — nothing needs to tune it. */
const RETRY_BACKOFF_MS = 500;

/**
 * Transient, unambiguously pre-delivery nodemailer codes — safe to retry (no duplicate send).
 * nodemailer's own ETIMEDOUT is a connection-phase timeout (pre-DATA); it is distinct from the
 * per-attempt TimeoutError thrown by the pTimeout wrapper below, which has no `.code` and is
 * therefore NOT retried. createSmtpTransport sets its connection-phase timeouts below
 * DEFAULT_TIMEOUT_MS so a hung connect surfaces here as a retryable ETIMEDOUT.
 */
const RETRYABLE_SMTP_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS']);

/** Universal across messages (spec principle 1), therefore internal — not injectable, not exported. */
function isTransientSmtpError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return !!code && RETRYABLE_SMTP_CODES.has(code);
}

export interface SendOptions {
  /** Retries after the first attempt. Default 0. */
  retries?: number;
  /** Per-attempt timeout (ms). Default 10_000; pass 0 to disable. */
  timeout?: number;
}

/** The one delivery primitive: send a fully-addressed message with retry + timeout policy. */
export function sendMail(
  transport: MailTransport,
  message: MailMessage,
  options: SendOptions = {},
): Promise<SendResult> {
  const { retries = 0, timeout = DEFAULT_TIMEOUT_MS } = options;
  return pRetry(
    () => {
      const attempt = transport.send(message);
      return timeout ? pTimeout(attempt, { milliseconds: timeout }) : attempt;
    },
    {
      retries,
      minTimeout: RETRY_BACKOFF_MS,
      factor: 1,
      // A pTimeout TimeoutError has no `.code`, so a timed-out attempt is never retried.
      shouldRetry: ({ error }) => isTransientSmtpError(error),
    },
  );
}
