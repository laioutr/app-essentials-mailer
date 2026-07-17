import { useMailer } from '#imports';
import { WithdrawalAction } from '@laioutr-core/canonical-types/ecommerce';
import { getWithdrawalStrings } from '../../mail/withdrawal/strings';
import { renderWithdrawalAck, renderWithdrawalStoreNotice } from '../../mail/withdrawal/templates';
import { defineEssentialsMailerAction } from '../../middleware';

/**
 * Registers the WithdrawalAction handler (auto-discovered via the module's orchestrDirs).
 * Sends two emails on top of the reusable mail layer:
 *   1. Store notice (critical) — awaited, retried once; failure returns success:false.
 *   2. Consumer acknowledgement (best-effort) — deferred past the response via event.waitUntil.
 */
export default defineEssentialsMailerAction(WithdrawalAction, async ({ input, clientEnv, event }) => {
  const locale = clientEnv.locale;
  const { sendMail, ctx, config } = useMailer(locale);
  const vars = { ...input, submittedAt: new Date() };

  // 1. Store notice — critical: awaited, retried once, failure surfaces to the caller.
  try {
    await sendMail(
      {
        ...renderWithdrawalStoreNotice(ctx, vars),
        to: config.recipient,
        from: config.from,
        replyTo: config.replyToConsumer === false ? undefined : input.email,
      },
      { retries: 1 },
    );
  } catch (error) {
    console.warn('[essentials-mailer] withdrawal store notice failed', error);
    return { success: false, message: getWithdrawalStrings(locale).errors.deliveryFailed };
  }

  // 2. Consumer acknowledgement — best-effort: deferred past the response, retried, failure logged.
  event.waitUntil(
    sendMail({ ...renderWithdrawalAck(ctx, vars), to: input.email, from: config.from }, { retries: 1 }).catch(
      (error) => console.warn('[essentials-mailer] withdrawal consumer acknowledgement failed', error),
    ),
  );

  return { success: true };
});
