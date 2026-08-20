import { useMailer } from '#imports';
import { WithdrawalAction } from '@laioutr-core/canonical-types/ecommerce';
import { resolveWithdrawalSettings } from '../../mail/withdrawal/settings';
import { getWithdrawalStrings } from '../../mail/withdrawal/strings';
import { renderWithdrawalAck, renderWithdrawalStoreNotice } from '../../mail/withdrawal/templates';
import { defineEssentialsMailerAction } from '../../middleware';

/**
 * Registers the WithdrawalAction handler (auto-discovered via the module's orchestrDirs).
 * Addressing and toggles come from `resolveWithdrawalSettings` — global config defaults with
 * `actions.withdrawal` overrides applied. Sends up to two emails on the reusable mail layer:
 *   1. Store notice (critical) — awaited, retried once; failure returns success:false.
 *   2. Consumer acknowledgement (best-effort, opt-out via `consumerAck: false`) — awaited in the
 *      request path, retried; a failure is logged but does not fail the withdrawal (the store
 *      notice already delivered it).
 */
export default defineEssentialsMailerAction(WithdrawalAction, async ({ input, clientEnv }) => {
  const locale = clientEnv.locale;
  const { sendMail, ctx, config } = useMailer(locale);
  const { from, recipient, replyToConsumer, consumerAck } = resolveWithdrawalSettings(config);
  const vars = { ...input, submittedAt: new Date() };

  // 1. Store notice — critical: awaited, retried once, failure surfaces to the caller.
  try {
    await sendMail(
      {
        ...renderWithdrawalStoreNotice(ctx, vars),
        to: recipient,
        from,
        replyTo: replyToConsumer ? input.email : undefined,
      },
      { retries: 1 },
    );
  } catch (error) {
    console.warn('[essentials-mailer] withdrawal store notice failed', error);
    return { success: false, message: getWithdrawalStrings(locale).errors.deliveryFailed };
  }

  // 2. Consumer acknowledgement — best-effort: awaited here, retried; a failure is logged but does
  //    not fail the withdrawal (the store notice already delivered it to the trader).
  if (consumerAck) {
    await sendMail(
      { ...renderWithdrawalAck(ctx, vars), to: input.email, from },
      { retries: 1 },
    ).catch((error) =>
      console.warn('[essentials-mailer] withdrawal consumer acknowledgement failed', error),
    );
  }

  return { success: true };
});
