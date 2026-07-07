// Config types are re-exported type-only from the single source of truth (src/config-types.ts),
// so runtime code carries no build-time coupling.
export type { MailerConfig, SmtpTransportConfig } from '../../../../config-types';

/** A fully-addressed email to send. `from` is explicit so the transport is a thin envelope. */
export interface MailMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  messageId?: string;
}

/** The reusable transport seam. Additional providers implement this behind resolveTransport. */
export interface MailTransport {
  send(message: MailMessage): Promise<SendResult>;
}
