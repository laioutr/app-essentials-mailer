import { createTransport } from 'nodemailer';
import type { MailMessage, MailTransport, SendResult, SmtpTransportConfig } from './types';

/**
 * Connection-phase timeouts (ms) — kept below delivery.ts's per-attempt wrapper
 * (DEFAULT_TIMEOUT_MS = 10_000) so a hung connect / DNS / greeting surfaces as nodemailer's
 * retryable ETIMEDOUT before the wrapper's non-retryable TimeoutError fires. socketTimeout keeps
 * nodemailer's default: post-DATA inactivity is not provably pre-delivery, so it is not retried.
 */
const CONNECTION_PHASE_TIMEOUT_MS = 8_000;

/**
 * SMTP transport backed by nodemailer. SMTP is the universal provider abstraction —
 * Resend/SES/Postmark/Brevo all expose SMTP credentials — so this already supports them.
 */
export function createSmtpTransport(config: SmtpTransportConfig): MailTransport {
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
    connectionTimeout: CONNECTION_PHASE_TIMEOUT_MS,
    greetingTimeout: CONNECTION_PHASE_TIMEOUT_MS,
    dnsTimeout: CONNECTION_PHASE_TIMEOUT_MS,
  });

  return {
    async send(message: MailMessage): Promise<SendResult> {
      const info = await transporter.sendMail({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { messageId: info?.messageId };
    },
  };
}
