import type { MailAddressingConfig, MailerConfig } from '../../../config-types';

/** Addressing with the action's overrides applied and every optional resolved. */
export interface ResolvedAddressing {
  from: string;
  recipient: string;
  replyToConsumer: boolean;
}

/** Global defaults ← per-action overrides. The single place the fallback contract lives. */
export function resolveAddressing(
  config: MailerConfig,
  override: MailAddressingConfig | undefined,
): ResolvedAddressing {
  return {
    from: override?.from ?? config.from,
    recipient: override?.recipient ?? config.recipient,
    // `!== false`, not `?? true`: the config is unvalidated and the documented contract is
    // "when not false". Reproduces the action's previous check for every input.
    replyToConsumer: (override?.replyToConsumer ?? config.replyToConsumer) !== false,
  };
}
