import { useRuntimeConfig } from '#imports';
import { name } from '../../../../package.json';
import { sendMail, type SendOptions } from '../mail/delivery';
import { resolveTransport } from '../mail/transport/resolveTransport';
import type { MailRenderContext } from '../mail/template/types';
import type { MailerConfig, MailMessage, SendResult } from '../mail/transport/types';

/** Reads the private mailer config and returns a transport-bound sender, the render context,
 *  and the config (for addressing). No `event`: `useRuntimeConfig()` returns the module-init
 *  shared config (env applied once at init), which is correct on this Node hosting. */
export function useMailer(locale: string): {
  sendMail: (message: MailMessage, options?: SendOptions) => Promise<SendResult>;
  ctx: MailRenderContext;
  config: MailerConfig;
} {
  const config = useRuntimeConfig()[name] as MailerConfig;
  const transport = resolveTransport(config);
  const ctx: MailRenderContext = {
    locale,
    timeZone: config.timeZone,
    shopName: config.brand.shopName,
    shopUrl: config.brand.shopUrl,
    footerLinks: config.brand.footerLinks,
  };
  return { sendMail: (message, options) => sendMail(transport, message, options), ctx, config };
}
