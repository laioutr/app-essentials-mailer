import { useMailer } from '#imports';
import { WithdrawalAction } from '@laioutr-core/canonical-types/ecommerce';
import { submitToChannels } from '../../mail/channels';
import { resolveWithdrawalSettings } from '../../mail/withdrawal/settings';
import { getWithdrawalStrings } from '../../mail/withdrawal/strings';
import { renderWithdrawalAck, renderWithdrawalStoreNotice } from '../../mail/withdrawal/templates';
import { defineEssentialsMailerAction } from '../../middleware';

/** The withdrawal button's form, as the Cockpit's Email channel lists it. */
const WITHDRAWAL_FORM = { id: 'withdrawal', name: 'Withdrawal' };

/**
 * Registers the WithdrawalAction handler (auto-discovered via the module's orchestrDirs).
 *
 * In a Laioutr project the withdrawal goes through the project's Email channel: the Cockpit sends the store notice and
 * the consumer's acknowledgement, logs both and counts them against the project's quota, and its answer — a quota
 * reached included — is the visitor's. The storefront's own mail (`transport`) sends only where the Cockpit cannot take
 * it: Channels off, the channel not set up, the Cockpit unreachable.
 *
 * Through the storefront's own mail, addressing and toggles come from `resolveWithdrawalSettings` — global config
 * defaults with `actions.withdrawal` overrides applied. Sends up to two emails on the reusable mail layer:
 *   1. Store notice (critical) — awaited, retried once; failure returns success:false.
 *   2. Consumer acknowledgement (best-effort, opt-out via `consumerAck: false`) — awaited in the
 *      request path, retried; a failure is logged but does not fail the withdrawal (the store
 *      notice already delivered it).
 */
export default defineEssentialsMailerAction(WithdrawalAction, async ({ input, clientEnv }) => {
  const locale = clientEnv.locale;
  const { channels, sendMail, ctx, config } = useMailer(locale);
  const failed = { success: false, message: getWithdrawalStrings(locale).errors.deliveryFailed };

  if (channels) {
    const outcome = await submitToChannels(channels, {
      form: WITHDRAWAL_FORM,
      purpose: 'withdrawal',
      fields: { name: input.name, orderReference: input.orderReference },
      visitorEmail: input.email,
      locale,
    });
    if (outcome.kind === 'sent') return { success: true };
    if (outcome.kind === 'refused') return { success: false, message: outcome.message };
    console.warn(`[essentials-mailer] the Email channel could not take a withdrawal (${outcome.reason}); using own mail`);
  }

  const { from, recipient, replyToConsumer, consumerAck } = resolveWithdrawalSettings(config);
  if (!sendMail || !from || !recipient) {
    console.warn('[essentials-mailer] a withdrawal could not be delivered: no Email channel and no own mail configured');
    return failed;
  }
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
    return failed;
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
