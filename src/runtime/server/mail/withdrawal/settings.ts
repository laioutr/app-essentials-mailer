import type { MailerConfig } from '../../../../config-types';
import { resolveAddressing, type ResolvedAddressing } from '../addressing';

export interface WithdrawalSettings extends ResolvedAddressing {
  /** Whether the consumer acknowledgement (Eingangsbestätigung) is sent. */
  consumerAck: boolean;
}

/** Global addressing with the withdrawal block's overrides, plus the action's own toggles. */
export function resolveWithdrawalSettings(config: MailerConfig): WithdrawalSettings {
  const override = config.actions?.withdrawal;
  // `!== false`, matching `replyToConsumer`: one falsy-value contract across the whole schema.
  return { ...resolveAddressing(config, override), consumerAck: override?.consumerAck !== false };
}
