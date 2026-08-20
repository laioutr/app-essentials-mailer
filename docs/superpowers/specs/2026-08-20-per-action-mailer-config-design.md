# Per-action mailer config: global defaults with per-action overrides

**Date:** 2026-08-20

## Goal

Make mailer settings addressable **per action** instead of only globally, so a storefront can
route one action's notices to a different inbox and can turn an individual mail off. The
motivating case: the withdrawal consumer acknowledgement (*Eingangsbestätigung*) is currently
unconditional — `withdrawal.action.ts` sends it with no config read — and there is no way to
disable it short of an app-level plugin re-registering `WithdrawalAction` (the orchestr registry
is a plain `Map.set`, last writer wins) and rebuilding the store notice from scratch, because the
withdrawal templates are not part of the `./server` export surface.

## Scope decisions

Settled before design, recorded so they are not re-litigated:

| Question | Decision |
| --- | --- |
| What becomes per-action? | **On/off per mail** and **addressing per action**. |
| What does *not*? | Per-mail delivery policy (`retries`/`timeout`) and per-mail copy/branding overrides. |
| Config keyed by what? | **Action** (`actions.withdrawal`), each action owning its own sub-shape — not a flat per-mail id registry. |
| Global vs. per-action | **Global defaults + per-action overrides.** Top-level `from`/`recipient`/`replyToConsumer` remain the defaults; an action block overrides only what differs. |

Rejected: a per-mail-id keyed map (`mails: { 'withdrawal.consumerAck': … }`) — it forces every
future action to invent stable mail ids for a benefit no current requirement asks for. Rejected:
fully per-action addressing with no global defaults — five legal actions sharing one inbox and one
sender would repeat both five times.

## Config shape

`src/config-types.ts` gains three interfaces and one optional field on `MailerConfig`:

```ts
/** Addressing every action shares. An action block overrides only what differs. */
export interface MailAddressingConfig {
  /** Sender address; may be "Display Name <addr>" form. */
  from?: string;
  /** Address that receives this action's store notice. */
  recipient?: string;
  /** When not false, the store-notice reply-to is the consumer's email. */
  replyToConsumer?: boolean;
}

/** Per-action settings for the withdrawal (Widerruf) flow. */
export interface WithdrawalActionConfig extends MailAddressingConfig {
  /** When not false (default true), the consumer receives the acknowledgement. See the
   *  legal note in the README before disabling: § 356 Abs. 1 BGB. */
  consumerAck?: boolean;
}

/** One block per action this package ships; each action owns its own shape. */
export interface MailerActionsConfig {
  withdrawal?: WithdrawalActionConfig;
}

export interface MailerConfig {
  transport: TransportConfig;
  from: string;       // default sender for every action
  recipient: string;  // default trader inbox for every action
  replyToConsumer?: boolean;
  timeZone?: string;
  brand: MailerBrandConfig;
  /** Per-action overrides. Everything inside is optional; omitting it keeps today's behavior. */
  actions?: MailerActionsConfig;
}
```

In `nuxt.config`:

```ts
'@laioutr/app-essentials-mailer': {
  from: 'Shop <noreply@example.com>',
  recipient: 'legal@example.com',        // default inbox
  // …transport, brand, timeZone
  actions: {
    withdrawal: {
      recipient: 'widerruf@example.com', // this action goes elsewhere
      consumerAck: false,                // no Eingangsbestätigung
    },
  },
}
```

**One inheritance level, deliberately.** Addressing is genuinely shared across actions, so it is
one interface the action blocks extend. Action-specific toggles are not shared and stay on the
action's own interface. No base class for "an action config", no generics over an action key.

**`MailerActionsConfig` is an interface, not a `Record`.** With one owner today the keys are
closed and typo-checked. If a second essentials app ever contributes an action, it can widen the
type by declaration merging (`declare module … { interface MailerActionsConfig { … } }`) without
this design changing. Not built now; recorded so it is not rediscovered.

## Resolution seam

Two pure, Nuxt-free functions. The action reads one resolved object; no fallback chain appears at
a call site.

`src/runtime/server/mail/addressing.ts` (new):

```ts
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
    // `!== false`, not `?? true`: the config is unvalidated, and the documented contract is
    // "when not false". This reproduces the action's current test byte for byte, including for
    // falsy non-boolean values a malformed config could hold.
    replyToConsumer: (override?.replyToConsumer ?? config.replyToConsumer) !== false,
  };
}
```

`src/runtime/server/mail/withdrawal/settings.ts` (new):

```ts
import { resolveAddressing, type ResolvedAddressing } from '../addressing';
import type { MailerConfig } from '../../../../config-types';

export interface WithdrawalSettings extends ResolvedAddressing {
  /** Whether the consumer acknowledgement (Eingangsbestätigung) is sent. */
  consumerAck: boolean;
}

export function resolveWithdrawalSettings(config: MailerConfig): WithdrawalSettings {
  const override = config.actions?.withdrawal;
  // `!== false`, matching `replyToConsumer`: one falsy-value contract across the whole schema.
  return { ...resolveAddressing(config, override), consumerAck: override?.consumerAck !== false };
}
```

**Why a shared `resolveAddressing` with exactly one caller today.** The fallback semantics
(global ← override, `replyToConsumer` defaults true) are a contract of the *config schema*, not of
the withdrawal action. Establishing that contract in one place is the point of this redesign; the
alternative — inlining three `??` expressions per action — invites the second action to resolve
`replyToConsumer` differently. Six lines is a cheap price for that. The action-specific part
(`consumerAck`) stays in the action's own resolver, which is the ~8-line file each future action
copies.

**Why not inside `useMailer`.** `useMailer(locale)` is the generic in-module sender documented for
any server handler; teaching it action keys would make its return type generic over
`keyof MailerActionsConfig` and put action knowledge in Nuxt-runtime glue that has no unit tests.
The resolvers are pure and testable precisely because they sit below that line — the same
delivery/rendering vs. glue split the 2026-07-17 mail-layer design established.

Neither function is exported from `mail/index.ts`. The `./server` surface is the reusable,
withdrawal-free API; these are internal until a second consumer exists.

Both files import the config types **type-only, straight from `src/config-types.ts`** — the same
way `mail/transport/types.ts` sources them, so runtime code carries no build-time coupling.
`MailAddressingConfig` is not added to the `transport/types.ts` re-export: addressing is not
transport knowledge.

## Action changes

`src/runtime/server/orchestr/legal/withdrawal.action.ts`:

```ts
const { sendMail, ctx, config } = useMailer(locale);
const { from, recipient, replyToConsumer, consumerAck } = resolveWithdrawalSettings(config);
const vars = { ...input, submittedAt: new Date() };

// 1. Store notice — semantics unchanged: awaited, retried once, terminal failure returns
//    { success: false, message: getWithdrawalStrings(locale).errors.deliveryFailed }.
//    Only the three addressing expressions change; the try/catch stays exactly as it is.
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
  /* unchanged */
}

// 2. Consumer acknowledgement — now gated; the send itself is unchanged.
if (consumerAck) {
  await sendMail({ ...renderWithdrawalAck(ctx, vars), to: input.email, from }, { retries: 1 })
    .catch((error) =>
      console.warn('[essentials-mailer] withdrawal consumer acknowledgement failed', error),
    );
}
```

The `config.replyToConsumer === false ? undefined : input.email` inversion disappears —
normalization happens once, in the resolver. Delivery policy, retry budgets, error handling, and
the store-notice failure path are untouched.

## Compatibility

Purely additive. `actions` is optional and every field inside it is optional, so an existing config
resolves to exactly today's values: `from`/`recipient` from the top level, `replyToConsumer`
defaulting to true, `consumerAck` defaulting to true. No migration, no deprecation window, no
change to the runtime-config namespace. A minor version bump.

`withdrawal.action.ts` is the only consumer of `from`/`recipient`/`replyToConsumer` in the package
— every other occurrence is documentation — so the resolver has exactly one call site to preserve.
It preserves it exactly: `replyToConsumer` resolves through `!== false` rather than `?? true`, so a
config holding a falsy non-boolean (possible: nothing validates this config) keeps sending the
reply-to header, as it does today. Nothing is renamed, removed, or made required; `useMailer`'s
signature, the runtime-config namespace, and the `./server` export surface are untouched, and the
two resolvers are new internal files rather than replacements.

The one intended behavior change is the point of the feature: with `actions.withdrawal.consumerAck`
set to `false`, the acknowledgement is not sent. Absent that key, byte-identical behavior.

`module.ts` merges options with `defu`, which deep-merges plain objects — an `actions.withdrawal`
block given in `nuxt.config`'s `runtimeConfig` merges with one given in module options, key by
key. No arrays are introduced, so defu's array-concat behavior is not in play.

Env-var override of a nested key is no more or less usable than before: the runtime-config
namespace is `@laioutr/app-essentials-mailer`, whose `@` and `/` already make `NUXT_*` overrides
impractical. Consumers source secrets from `process.env` in `nuxt.config`, as the README shows.

Config remains **unvalidated by design** — a misconfiguration surfaces as a failed send at request
time, not at boot. This design adds no validation and no boot-time warning.

## Legal note

`consumerAck` defaults to `true`. Under § 356 Abs. 1 BGB a trader must confirm receipt of a
withdrawal submitted through an online form on a durable medium without undue delay. Turning the
acknowledgement off is a deliberate operator decision with legal consequences, not a neutral
preference. The README documents this next to the option; the code does not attempt to prevent it.

## Testing

New `test/withdrawal-settings.test.ts` (pure, no Nuxt):

- Empty `actions`: `from`/`recipient` come from the top level, `replyToConsumer` is `true`,
  `consumerAck` is `true`.
- Per-action override wins for `from`, `recipient`, and `replyToConsumer` independently.
- Global `replyToConsumer: false` with an action-level `true` resolves to `true` (override wins in
  both directions, not just when enabling).
- A falsy non-boolean `replyToConsumer` (e.g. `0`, cast in — the config is unvalidated) resolves to
  `true`, pinning the `!== false` contract against a future `?? true` "simplification".
- `consumerAck: false` resolves to `false`; `consumerAck` absent resolves to `true`.

Existing suites (`delivery`, `transport`, `render-form-email`, `withdrawal-templates`,
`withdrawal-strings`, `email-i18n`, `compiled-layout`) are unaffected — no template, transport, or
delivery behavior changes.

**Known gap, unchanged by this design:** the action handler itself has no test, so "the ack send is
actually skipped when `consumerAck` is false" is covered only at the resolver level. This is the
same tradeoff the 2026-07-17 design accepted when `handleWithdrawal` was dissolved into the action.
Adding a Nuxt-runtime action test is a separate, deliberate piece of work — out of scope here.

## Documentation

- README config example gains an `actions.withdrawal` block.
- README config table gains `actions`, `actions.withdrawal.recipient`, `actions.withdrawal.from`,
  `actions.withdrawal.replyToConsumer`, `actions.withdrawal.consumerAck`, each noting that it
  overrides the top-level default.
- A short paragraph states the override rule once (global default ← action override) and carries
  the § 356 BGB note for `consumerAck`.
- The playground config stays on the flat form (it exercises the default path); the README carries
  the override example.

## Out of scope

- **Cockpit-managed config.** The platform's app-install mechanism (`app_versions.config_schema` →
  `project_apps.config`, laioutr `docs/plans/2026-02-16-app-install-config-design.md`) is not
  adopted here. The shape is chosen so each action block maps to one fieldset if it is adopted
  later; nothing in this design blocks that.
- **Per-mail delivery policy and copy overrides** — explicitly declined above.
- **Config validation** — the package's standing "no validation by design" stance holds.
- **Exporting the resolvers or the withdrawal templates** from `./server`.
