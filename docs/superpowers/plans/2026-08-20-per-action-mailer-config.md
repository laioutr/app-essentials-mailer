# Per-Action Mailer Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a storefront override mailer addressing per action and switch an individual mail off — concretely, disable the withdrawal consumer acknowledgement (*Eingangsbestätigung*) via `actions.withdrawal.consumerAck: false`.

**Architecture:** `MailerConfig` gains an optional `actions` block; top-level `from`/`recipient`/`replyToConsumer` stay the global defaults an action block overrides. Two pure, Nuxt-free resolvers do the merge — a shared `resolveAddressing` holding the fallback contract, and a per-action `resolveWithdrawalSettings` adding the action's own toggles. The withdrawal action reads one fully-resolved object instead of reaching into config, so no fallback chain appears at a call site.

**Tech Stack:** TypeScript 5.9, Nuxt 3 module (private `runtimeConfig`), Vitest 3, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-20-per-action-mailer-config-design.md`

## Global Constraints

- Runtime: Node `>=22.12.0`, pnpm `>=10.15.0`. Run all commands from the repo root with pnpm.
- Work directly on `main` — no branches, no worktrees (repo convention). Commit at the end of each task with a conventional-commit message. **These commits are plan-authorized**; do not ask per commit.
- **Purely additive.** No config key may be renamed, removed, or made required. `actions` and everything under it is optional.
- **No config validation.** The package's standing stance is "no validation by design" — do not add zod, boot-time checks, or startup warnings.
- **The falsy contract is `!== false`, never `?? true`** — for both `replyToConsumer` and `consumerAck`. The config is unvalidated and may hold non-booleans; `!== false` reproduces the action's current behavior exactly and matches the documented wording "when not false (default true)".
- Config types are imported **type-only from `src/config-types.ts`** (the single source of truth), the way `src/runtime/server/mail/transport/types.ts` already does it. Do **not** add `MailAddressingConfig` to the `transport/types.ts` re-export — addressing is not transport knowledge.
- Do **not** export the new resolvers from `src/runtime/server/mail/index.ts`. The `./server` public surface is unchanged by this work.
- No new dependencies.
- No new user-facing copy — the toggle adds no strings, so `withdrawal/strings.ts` and the German/English content set are untouched.
- Do not touch transport, delivery, rendering, `useMailer`, or the playground config.

---

### Task 1: Config types + resolution seam

The whole merge contract, unit-tested. Nothing wired up yet — the action still behaves exactly as before at the end of this task.

**Files:**
- Modify: `src/config-types.ts` (add three interfaces; add `actions?` to `MailerConfig`; reword two doc comments)
- Create: `src/runtime/server/mail/addressing.ts`
- Create: `src/runtime/server/mail/withdrawal/settings.ts`
- Test: `test/withdrawal-settings.test.ts`

**Interfaces:**
- Consumes: `MailerConfig` from `src/config-types.ts` (exists).
- Produces:
  - `interface MailAddressingConfig { from?: string; recipient?: string; replyToConsumer?: boolean }`
  - `interface WithdrawalActionConfig extends MailAddressingConfig { consumerAck?: boolean }`
  - `interface MailerActionsConfig { withdrawal?: WithdrawalActionConfig }`
  - `MailerConfig.actions?: MailerActionsConfig`
  - `interface ResolvedAddressing { from: string; recipient: string; replyToConsumer: boolean }`
  - `resolveAddressing(config: MailerConfig, override: MailAddressingConfig | undefined): ResolvedAddressing`
  - `interface WithdrawalSettings extends ResolvedAddressing { consumerAck: boolean }`
  - `resolveWithdrawalSettings(config: MailerConfig): WithdrawalSettings` — consumed by Task 2.

- [ ] **Step 1: Add the config types**

The test in Step 2 does not compile without these, so the types land first.

In `src/config-types.ts`, insert these three interfaces after the `MailerBrandConfig` interface and before the `MailerConfig` interface:

```ts
/** Addressing every action shares. An action block overrides only what differs. */
export interface MailAddressingConfig {
  /** Sender address; may be "Display Name <addr>" form. Defaults to the top-level `from`. */
  from?: string;
  /** Address that receives this action's store notice. Defaults to the top-level `recipient`. */
  recipient?: string;
  /** When not false, the store-notice reply-to is the consumer's email. */
  replyToConsumer?: boolean;
}

/** Per-action settings for the withdrawal (Widerruf) flow. */
export interface WithdrawalActionConfig extends MailAddressingConfig {
  /** When not false (default true), the consumer receives the acknowledgement
   *  (Eingangsbestätigung). Read the § 356 Abs. 1 BGB note in the README before disabling. */
  consumerAck?: boolean;
}

/** One block per action this package ships; each action owns its own shape. */
export interface MailerActionsConfig {
  withdrawal?: WithdrawalActionConfig;
}
```

Then, in `MailerConfig`, reword the `from` and `recipient` doc comments (they are now defaults, not the only value) and add the `actions` field. The interface becomes exactly:

```ts
/** The private config stored in runtimeConfig[name]. Not validated (by design). */
export interface MailerConfig {
  transport: TransportConfig;
  /** Default sender address; may be "Display Name <addr>" form. An action block may override it. */
  from: string;
  /** Default address that receives store notices. An action block may override it. */
  recipient: string;
  /** When not false (default true), the store-notice reply-to is the consumer's email. */
  replyToConsumer?: boolean;
  /** IANA timezone for displayed dates; omitted or invalid values use UTC. */
  timeZone?: string;
  /** Shop branding shown in every email's header and footer. */
  brand: MailerBrandConfig;
  /** Per-action overrides. Everything inside is optional; omitting it keeps the global defaults. */
  actions?: MailerActionsConfig;
}
```

Leave `SmtpTransportConfig`, `TransportConfig`, `FooterLink`, `MailerBrandConfig`, and `ModuleOptions` untouched.

- [ ] **Step 2: Write the failing test**

Create `test/withdrawal-settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MailerConfig, WithdrawalActionConfig } from '../src/config-types';
import { resolveWithdrawalSettings } from '../src/runtime/server/mail/withdrawal/settings';

const base: MailerConfig = {
  transport: { type: 'smtp', host: 'localhost', port: 1025, auth: { user: 'u', pass: 'p' } },
  from: 'Shop <noreply@example.com>',
  recipient: 'legal@example.com',
  brand: { shopName: 'Example Shop' },
};

const withAction = (withdrawal: WithdrawalActionConfig): MailerConfig => ({
  ...base,
  actions: { withdrawal },
});

describe('resolveWithdrawalSettings', () => {
  it('falls back to the global defaults and enables both toggles with no action block', () => {
    expect(resolveWithdrawalSettings(base)).toEqual({
      from: 'Shop <noreply@example.com>',
      recipient: 'legal@example.com',
      replyToConsumer: true,
      consumerAck: true,
    });
  });

  it('overrides each addressing field independently', () => {
    expect(resolveWithdrawalSettings(withAction({ recipient: 'widerruf@example.com' }))).toMatchObject({
      from: 'Shop <noreply@example.com>',
      recipient: 'widerruf@example.com',
    });
    expect(resolveWithdrawalSettings(withAction({ from: 'Legal <legal@example.com>' }))).toMatchObject({
      from: 'Legal <legal@example.com>',
      recipient: 'legal@example.com',
    });
  });

  it('lets the action override replyToConsumer in both directions', () => {
    const disabled = { ...base, replyToConsumer: true, actions: { withdrawal: { replyToConsumer: false } } };
    const enabled = { ...base, replyToConsumer: false, actions: { withdrawal: { replyToConsumer: true } } };
    expect(resolveWithdrawalSettings(disabled).replyToConsumer).toBe(false);
    expect(resolveWithdrawalSettings(enabled).replyToConsumer).toBe(true);
  });

  it('disables replyToConsumer only on an explicit false', () => {
    expect(resolveWithdrawalSettings({ ...base, replyToConsumer: false }).replyToConsumer).toBe(false);
    // The config is unvalidated: a falsy non-boolean is not `false` and must keep the header,
    // exactly as the pre-existing `=== false` check did. Pins the contract against `?? true`.
    const malformed = { ...base, replyToConsumer: 0 as unknown as boolean };
    expect(resolveWithdrawalSettings(malformed).replyToConsumer).toBe(true);
  });

  it('sends the consumer acknowledgement unless it is explicitly false', () => {
    expect(resolveWithdrawalSettings(withAction({})).consumerAck).toBe(true);
    expect(resolveWithdrawalSettings(withAction({ consumerAck: true })).consumerAck).toBe(true);
    expect(resolveWithdrawalSettings(withAction({ consumerAck: false })).consumerAck).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run test/withdrawal-settings.test.ts`
Expected: FAIL — cannot resolve `../src/runtime/server/mail/withdrawal/settings` (the module does not exist yet).

- [ ] **Step 4: Write the shared addressing resolver**

Create `src/runtime/server/mail/addressing.ts`:

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
    // `!== false`, not `?? true`: the config is unvalidated and the documented contract is
    // "when not false". Reproduces the action's previous check for every input.
    replyToConsumer: (override?.replyToConsumer ?? config.replyToConsumer) !== false,
  };
}
```

- [ ] **Step 5: Write the withdrawal resolver**

Create `src/runtime/server/mail/withdrawal/settings.ts`:

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run test/withdrawal-settings.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 7: Lint the new files**

Run: `pnpm lint`
Expected: no errors. If the import order in `settings.ts` is flagged, keep type-only imports first and order the relative specifiers alphabetically (`../../../../config-types` before `../addressing`).

- [ ] **Step 8: Commit**

```bash
git add src/config-types.ts src/runtime/server/mail/addressing.ts src/runtime/server/mail/withdrawal/settings.ts test/withdrawal-settings.test.ts
git commit -m "feat: resolve mailer addressing and withdrawal toggles per action"
```

---

### Task 2: Wire the withdrawal action and document the surface

Makes the feature real: the action reads the resolved settings, and the acknowledgement becomes opt-out. The README gains the new keys and the legal note.

**Files:**
- Modify: `src/runtime/server/orchestr/legal/withdrawal.action.ts`
- Modify: `README.md` (config example, config table, override-rule paragraph)

**Interfaces:**
- Consumes: `resolveWithdrawalSettings(config: MailerConfig): WithdrawalSettings` from Task 1.
- Produces: no new exported surface.

- [ ] **Step 1: Rewrite the action handler**

There is no unit test for this file — the action is Nuxt-runtime glue (`#imports`), a gap the 2026-07-17 design accepted and this plan does not close. Correctness here rests on Task 1's resolver tests plus the typecheck and full suite in Steps 2-4. Replace the entire contents of `src/runtime/server/orchestr/legal/withdrawal.action.ts` with:

```ts
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
```

The only behavioral change is the `if (consumerAck)` gate. Retry budgets, the store-notice failure path, and the log messages are unchanged.

- [ ] **Step 2: Typecheck the module and playground**

Run: `pnpm dev:prepare`
Expected: completes without error (builds emails, stubs and prepares the module, prepares the playground, resolves `#imports`).

Run: `pnpm test:types`
Expected: PASS — `vue-tsc --noEmit` clean for both the module and the playground. The playground config has no `actions` block, which must still typecheck: that is the additive guarantee.

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: PASS — every pre-existing suite (`delivery`, `transport`, `render-form-email`, `withdrawal-templates`, `withdrawal-strings`, `email-i18n`, `compiled-layout`) plus `withdrawal-settings`. No test should need editing; if one fails, the change broke something that was supposed to be untouched.

- [ ] **Step 4: Document the config keys**

In `README.md`, add the `actions` block to the config example. Insert it after the `brand: { … }` block and before the closing brace of `'@laioutr/app-essentials-mailer'`:

```ts
      actions: {
        // Per-action overrides; every key falls back to the global default above.
        withdrawal: {
          recipient: 'widerruf@example.com', // this action's notices go elsewhere
          consumerAck: true, // false disables the consumer acknowledgement — see the note below
        },
      },
```

Add these rows to the end of the config table (keep the existing column alignment style):

```markdown
| `actions`          | `{ withdrawal?: … }` (optional) | Per-action overrides of the addressing defaults above.                    |
| `actions.withdrawal.recipient` | `string` (optional) | Overrides `recipient` for withdrawal notices.                    |
| `actions.withdrawal.from`      | `string` (optional) | Overrides `from` for both withdrawal emails.                     |
| `actions.withdrawal.replyToConsumer` | `boolean` (optional) | Overrides `replyToConsumer` for the withdrawal store notice. |
| `actions.withdrawal.consumerAck` | `boolean` (default `true`) | When not `false`, the consumer receives the acknowledgement.  |
```

Then add this paragraph immediately after the table's existing `timeZone` paragraph and before the "There is **no config validation** by design" paragraph:

```markdown
Every key under `actions.<action>` overrides the matching top-level default for that action only;
anything omitted falls back. So a single trader inbox stays a single top-level `recipient`, and an
action that needs its own inbox names it in its own block.

> **Legal note on `consumerAck`.** Under § 356 Abs. 1 BGB a trader must confirm receipt of a
> withdrawal submitted through an online form on a durable medium without undue delay. The
> acknowledgement is sent by default; setting `consumerAck: false` is a deliberate operator
> decision with legal consequences, not a formatting preference.
```

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/server/orchestr/legal/withdrawal.action.ts README.md
git commit -m "feat: make the withdrawal consumer acknowledgement configurable per action"
```

---

## Manual verification (optional, requires an SMTP inbox)

Not part of any task's gate — the automated gates above are the contract. With a test SMTP (Mailpit, Ethereal, Mailtrap) configured in `playground/nuxt.config.ts`, run `pnpm dev`, open `playground/pages/orchestr.vue`, and invoke `ecommerce/legal/withdrawal`:

1. With no `actions` block: two emails arrive, the store notice at the top-level `recipient` with reply-to set to the consumer.
2. With `actions: { withdrawal: { consumerAck: false } }`: exactly one email arrives (the store notice), and the action still returns `{ success: true }`.
3. With `actions: { withdrawal: { recipient: 'other@localhost' } }`: the store notice arrives at `other@localhost`, the acknowledgement still at the consumer address.
