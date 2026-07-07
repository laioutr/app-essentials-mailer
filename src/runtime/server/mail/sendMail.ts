import { resolveTransport } from './transport/resolveTransport';
import type { MailMessage, MailerConfig, SendResult } from './transport/types';

/** Resolve the transport from config and send one message. The shared low-level send. */
export function sendMail(config: MailerConfig, message: MailMessage): Promise<SendResult> {
  return resolveTransport(config).send(message);
}
