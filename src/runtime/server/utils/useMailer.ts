import { useRuntimeConfig } from '#imports';
import type { MailRenderContext } from '../mail/template/types';
import type { MailerConfig, MailMessage, SendResult } from '../mail/transport/types';
import { name } from '../../../../package.json';
import { CHANNELS_URL_ENV, type ChannelsTarget, channelsTargetOf } from '../mail/channels';
import { sendMail, type SendOptions } from '../mail/delivery';
import { resolveTransport } from '../mail/transport/resolveTransport';

/** Reads the private mailer config and returns the project's Email channel, the storefront's own mail where a
 *  transport is configured, the render context, and the config (for addressing). No `event`: `useRuntimeConfig()`
 *  returns the module-init shared config (env applied once at init), which is correct on this Node hosting. */
export function useMailer(locale: string): {
  channels: ChannelsTarget | null;
  sendMail: ((message: MailMessage, options?: SendOptions) => Promise<SendResult>) | null;
  ctx: MailRenderContext;
  config: MailerConfig;
} {
  const runtimeConfig = useRuntimeConfig();
  const config = runtimeConfig[name] as MailerConfig;
  const laioutr = runtimeConfig.laioutr as { projectSlug?: string; projectSecretKey?: string } | undefined;
  const channels = channelsTargetOf({
    enabled: config.channels?.enabled,
    url: process.env[CHANNELS_URL_ENV] || config.channels?.url,
    projectSlug: laioutr?.projectSlug,
    projectSecretKey: laioutr?.projectSecretKey,
    environmentName: config.environmentName,
    dev: import.meta.dev,
  });
  const transport = config.transport ? resolveTransport({ transport: config.transport }) : null;
  const ctx: MailRenderContext = {
    locale,
    timeZone: config.timeZone,
    shopName: config.brand?.shopName ?? '',
    shopUrl: config.brand?.shopUrl,
    footerLinks: config.brand?.footerLinks,
  };
  return {
    channels,
    sendMail: transport ? (message, options) => sendMail(transport, message, options) : null,
    ctx,
    config,
  };
}
