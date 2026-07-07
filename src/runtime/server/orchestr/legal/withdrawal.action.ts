import { useRuntimeConfig } from '#imports';
import { WithdrawalAction } from '@laioutr-core/canonical-types/ecommerce';
import type { MailerConfig } from '../../mail/transport/types';
import { name } from '../../../../../package.json';
import { renderFormEmail } from '../../mail/template/renderFormEmail';
import { getShell } from '../../mail/template/shells';
import { resolveTransport } from '../../mail/transport/resolveTransport';
import { handleWithdrawal } from '../../mail/withdrawal/handleWithdrawal';
import { defineEssentialsMailerAction } from '../../middleware';

/**
 * Registers the WithdrawalAction handler (auto-discovered via the module's orchestrDirs).
 * Thin wiring only: pulls the private mailer config, binds the compiled shell to the
 * renderer, and delegates all logic to the pure, tested `handleWithdrawal`.
 */
export default defineEssentialsMailerAction(WithdrawalAction, async ({ input, clientEnv, event }) => {
  const config = useRuntimeConfig(event)[name] as MailerConfig;
  const shell = getShell('form-email');
  return handleWithdrawal({
    input,
    locale: clientEnv.locale,
    config,
    transport: resolveTransport(config),
    renderEmail: (o) => renderFormEmail({ shell, ...o }),
    now: () => new Date(),
  });
});
