import { createSmtpTransport } from './smtp';
import type { MailTransport, TransportConfig } from './types';

/** Returns the transport adapter for the configured transport.type (only 'smtp' in v1). */
export function resolveTransport(config: { transport: TransportConfig }): MailTransport {
  switch (config.transport.type) {
    case 'smtp':
      return createSmtpTransport(config.transport);
    default:
      throw new Error(
        `Unsupported mail transport type: ${(config.transport as { type: string }).type}`,
      );
  }
}
