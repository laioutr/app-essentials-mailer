# Generalized Mail Layer: delivery (retry/timeout) + templates (rendering), meeting at `MailMessage`

**Date:** 2026-07-17
**Revised:** 2026-07-17 — (1) dropped the facade layer (`createMailer`/`renderMail`/`MailTemplate` machinery); templates are plain functions and `sendMail` takes a finished message. (2) `renderFormEmail` owns its layout (injectable `layout` param and the `getShell` registry deleted) and takes the render context as one `ctx` object; `formMail` helper removed. (3) Audit round: p-retry's native `shouldRetry`, `SendOptions` trimmed to `retries`/`timeout`, module-scope layout compile, `RenderedMail` internal, SMTP connection-phase timeouts so retry actually fires on hangs, README + testing-plan corrections. (4) Review round: event-less `useRuntimeConfig()` stands (rationale corrected — module-init env application, not ALS), server auto-import restored (ambient utils are the consumption model), `RenderedMail` standalone.

## Goal

Generalize the essentials mail layer into small, reusable, publicly-composable pieces:

1. **Delivery** — extract the retry logic inlined in `handleWithdrawal` into a reusable `sendMail(transport, message, options)` primitive, and add a per-attempt send timeout (new capability).
2. **Rendering** — replace the "one implicit form renderer" model with named **templates**: plain functions `(ctx, vars) → { subject, html, text }` that callers invoke directly. Rename the confusing "shell" concept to **layout**.

The two layers meet at a value, not an abstraction: `MailMessage = { ...template(ctx, vars), to, from, replyTo }`. The withdrawal-specific two-email orchestration dissolves into its action handler on top of these layers, wired by a thin `useMailer` composable.

## Motivation

`handleWithdrawal.ts` owns a `pRetry` loop with an inline SMTP error classifier and ad-hoc per-message policy; none of it is reusable by the next flow (more legal actions are anticipated under `orchestr/legal/`; the package's public API is meant for future essentials apps to compose). There is also no send timeout, so a hung SMTP connection blocks the request indefinitely.

Separately, the rendering layer conflates two concepts under the name "shell":

- `renderFormEmail` is really the renderer for **one layout** (`form-email`) — it hard-codes that layout's form-specific structure: the `{{#each fields}}` row loop, the `formType`/`submittedAt` metadata rows and their `CHROME` de/en labels, and the `submittedAt` Intl formatting. A non-form mail (order-shipped, password-reset) cannot use it.
- The two withdrawal emails are **not** separate templates today. They are the *same* `form-email` layout filled with different `heading`/`intro`/`subject` (from `strings.ts`) and the *same* `fields`. The distinction that deserves a name — the message definition — has none.

"Shell" is the term the build script coins (`export const <name>Shell = ...`); it means the compiled, style-inlined outer HTML skeleton with `{{token}}` holes. It is literally a Handlebars **template/layout**, and the `*Shell` naming is opaque.

## Design principles

1. **Retryability is a property of the error, not the message.** The transient SMTP codes (`ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `EDNS`) are connection-setup failures — the SMTP conversation never reached `DATA`, so retrying cannot duplicate a send. That safety property holds for every message, so the classifier is **universal** — and therefore **internal**: it is not injectable per call and not exported. An API knob for a universal property would contradict the property. (It *is* transport-family knowledge, though — see the residual notes.)
2. **Importance is a property of the message** and governs only two things: terminal failure handling (surface vs. swallow) and retry budget. Both live at the call site. The only per-message delivery knobs are `retries` and `timeout`.
3. The transport stays a thin envelope; resilience lives one layer above it.
4. **Rendering and delivery meet at a value, not a facade.** A template is a plain function the caller invokes; `sendMail` takes the finished `MailMessage`. No layer exists whose job is to call one side on behalf of the other.
5. **Vocabulary:** a **layout** is the compiled HTML skeleton with token holes (formerly "shell"). A **template** is a named message definition — a function that fills a layout and attaches its subject. Each layout is owned by its typed renderer; there is no layout registry or string-keyed lookup.

## Architecture

```
delivery   transport (MailTransport.send)             thin provider envelope               ┐
             └─ sendMail(transport, message, opts?)   retry + per-attempt timeout          │ pure,
                                                                                           │ Nuxt-free,
rendering  templates: renderWithdrawalAck(ctx, vars) → { subject, html, text }                   │ unit-tested
             └─ renderFormEmail({ ctx, …content })    form-layout renderer,                │
                                                      owns the compiled formEmailLayout    ┘

           the axes meet at MailMessage: { ...template(ctx, vars), to, from, replyTo }
  ─────────────────────────────────────────────────────────────────────────────────────
           useMailer(locale)                          config → { sendMail, ctx, config }   ┐ Nuxt glue,
             └─ orchestr/legal/withdrawal.action.ts   per-request two-email orchestration  ┘ auto-imported
```

The line above `useMailer` is Nuxt-free and unit-tested; `useMailer` and the action are Nuxt-runtime glue.

### Delivery — `mail/delivery.ts` (new)

```ts
import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import type { MailMessage, MailTransport, SendResult } from './transport/types';

/** Per-attempt timeout default (ms). Bounds a hung send; does not enable another attempt. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Constant backoff before a retry (ms). Internal — nothing needs to tune it. */
const RETRY_BACKOFF_MS = 500;

/** Transient, unambiguously pre-delivery nodemailer codes — safe to retry (no duplicate send). */
const RETRYABLE_SMTP_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS']);

/** Universal across messages (see principle 1), therefore internal — not injectable, not exported. */
function isTransientSmtpError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return !!code && RETRYABLE_SMTP_CODES.has(code);
}

export interface SendOptions {
  /** Retries after the first attempt. Default 0. */
  retries?: number;
  /** Per-attempt timeout (ms). Default DEFAULT_TIMEOUT_MS; pass 0 to disable. */
  timeout?: number;
}

/** The one delivery primitive: send a fully-addressed message with retry + timeout policy. */
export function sendMail(
  transport: MailTransport,
  message: MailMessage,
  options: SendOptions = {},
): Promise<SendResult> {
  const { retries = 0, timeout = DEFAULT_TIMEOUT_MS } = options;
  return pRetry(
    () => {
      const attempt = transport.send(message);
      return timeout ? pTimeout(attempt, { milliseconds: timeout }) : attempt;
    },
    {
      retries,
      minTimeout: RETRY_BACKOFF_MS,
      factor: 1,
      // A pTimeout TimeoutError has no `.code`, so a timed-out attempt is never retried (see Behavior).
      shouldRetry: ({ error }) => isTransientSmtpError(error),
    },
  );
}
```

`sendMail` keeps the name of the v1 free function but fixes its signature: it takes a `MailTransport` (not `MailerConfig`) so unit tests inject a fake transport and never touch the network, and it gains the retry/timeout policy.

Three deliberate trims, verified against the installed deps:

- **p-retry@8's native `shouldRetry`** replaces the first draft's try/catch + `AbortError` wrapping + manual `new Error(String(error))` normalization. That pattern was inherited from `handleWithdrawal` (written for older p-retry); v8 rejects with the original error and normalizes non-Error throws itself. Same behavior, ~10 fewer lines, no `AbortError` import.
- **Backoff is not in `SendOptions`.** The first draft exported `minTimeout` as a "test seam", contradicting its own rationale for hard-coding `factor` ("a knob without a caller is a maintenance liability" — `minTimeout` had no production caller either). Tests cross the 500ms backoff with fake timers instead (see Testing).
- **`factor` stays hard-coded** at 1 (constant backoff), as before.

**Design note — why policy is not part of the transport.** Policy has per-**message** cardinality: retry budget and terminal handling are decided where the message's importance is known, per call. A transport has per-**config** cardinality: one instance, built once from `MailerConfig`. Baking policy into the transport gives it the wrong cardinality (a differently-decorated transport per call site, or a growing `send` signature every provider must honor), and the thin-envelope principle is what keeps a second provider a small adapter. The SMTP connection-phase timeouts below are not policy — they're the transport describing its own link behavior. See the residual notes for the one piece of delivery that *is* transport knowledge.

### Connection-phase timeouts — `transport/smtp.ts` (modified)

Nodemailer's phase-timeout defaults (dns 30s, greeting 30s, connection 2min, socket 10min) all exceed `DEFAULT_TIMEOUT_MS = 10s`. Without intervention, **every** hang — including a pure connection-phase hang, which is provably pre-`DATA` and safe to retry under principle 1 — hits the wrapper's non-retryable `TimeoutError` first, and the retryable-`ETIMEDOUT` path is dead code. So `createSmtpTransport` sets `dnsTimeout`/`connectionTimeout`/`greetingTimeout` to **8s** (internal constants, deliberately below the wrapper): a hang in any single connection phase surfaces as nodemailer's retryable `ETIMEDOUT` before the wrapper fires. `socketTimeout` keeps its default — inactivity there can be post-`DATA` territory, where the wrapper's non-retryable timeout is the correct, duplicate-safe backstop.

Cost: worst-case awaited latency for `retries: 1` becomes ~8s + 0.5s + 8s ≈ 17s (vs. 10s when no hang is ever retried) — the price of the retry actually firing. A pathological server that crawls through multiple phases without hanging in any single one still hits the 10s wrapper and aborts safely.

### Rendering — layouts, templates, and shared types

**Rename "shell" → "layout"** (vocabulary only — the build artifact and docs):

- `scripts/build-emails.mjs`: emit `export const <name>Layout = …` (was `<name>Shell`).
- `src/runtime/emails/compiled/form-email.ts`: `formEmailLayout` (regenerated by `pnpm build:emails`).

**`renderFormEmail` owns its layout.** The v1 injectable `shell: string` option (and the first draft's `layout: string` rename of it) is deleted: `renderFormEmail` imports `formEmailLayout` directly. The injection was not real configurability — the renderer is hard-coupled to the form-email layout's token vocabulary, so nothing else could ever be passed except a test fixture *mimicking that exact contract*, hand-maintained in parallel with the real artifact. The layout is a static string constant; importing it keeps the function exactly as pure (deterministic, no I/O). With no injection to serve, the `SHELLS`/`getShell` registry (`template/shells.ts`) is deleted rather than renamed — a string-keyed layout lookup is the stringly-typed seam this design already rejects. The compiled module is the registry: one export per layout, each consumed by its renderer.

The v1 compile-cache `Map` keyed by shell string is deleted along with the injection that motivated it: with exactly one static layout there is one key forever (and the "future renderers share it" framing was false anyway — the `Map` was module-private). The layout is compiled once at module scope; Handlebars parses lazily on first render, so import-time cost is nil.

**`renderFormEmail` takes the context as one value.** The v1 options took `locale`/`timeZone`/`shopName`/`shopUrl`/`footerLinks` as five separate fields only because no context type existed yet. Those fields always travel together and are config/request-derived, not per-message, so the renderer takes them as `ctx: MailRenderContext`. This sets the convention every future layout renderer follows — **options = `ctx` + that layout's content** — and it deletes the bridging code templates would otherwise need to splat ctx back onto a flat signature:

```ts
import Handlebars from 'handlebars';
import { formEmailLayout } from '../../../emails/compiled/form-email';
import type { MailRenderContext } from './types';

export interface FormEmailField {
  label: string;
  value: string;
}

export interface RenderFormEmailOptions {
  ctx: MailRenderContext;
  heading: string;
  intro: string;
  formType: string;
  fields: FormEmailField[];
  submittedAt: Date;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/** Compiled once — the layout is a static module constant. */
const template = Handlebars.compile(formEmailLayout);

export function renderFormEmail(opts: RenderFormEmailOptions): RenderedEmail { /* as today,
  reading locale/timeZone/brand from opts.ctx and filling the layout */ }
```

`renderFormEmail` otherwise keeps its behavior — the `CHROME` labels, Intl date formatting, Handlebars escaping, html→text. It is now explicitly *one layout renderer of potentially several*, not "the mail renderer."

**New `template/types.ts`** — the shared render types (types only, zero runtime; `renderFormEmail.ts` imports from here, never the reverse, so there are no cycles):

```ts
export interface FormEmailLink {
  label: string;
  url: string;
}

/** Shared render context, assembled once from config + request locale. Templates pick the
 *  renderer; each renderer owns its layout — so no layout appears here. */
export interface MailRenderContext {
  locale: string;
  timeZone?: string;
  shopName: string;
  shopUrl?: string;
  footerLinks?: FormEmailLink[];
}

/** A template's output: everything a MailMessage needs except addressing. Internal (not
 *  exported from index): nothing exported consumes it. */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** The template convention, named for authoring convenience. Internal — not part of the public API. */
export type MailTemplate<Vars> = (ctx: MailRenderContext, vars: Vars) => RenderedMail;
```

There is deliberately **no `renderMail(template, ctx, vars)` entry point and no template-aware send facade.** See the design notes below.

**New `withdrawal/templates.ts`** — the two withdrawal templates (co-located with their strings). Each is self-contained: resolve strings, render, attach subject.

```ts
import { renderFormEmail, type FormEmailField } from '../template/renderFormEmail';
import { getWithdrawalStrings, type WithdrawalStrings } from './strings';
import type { MailTemplate } from '../template/types';

export interface WithdrawalVars {
  name: string;
  orderReference: string;
  email: string;
  submittedAt: Date;
}

const fields = (vars: WithdrawalVars, s: WithdrawalStrings): FormEmailField[] => [
  { label: s.fieldLabels.name, value: vars.name },
  { label: s.fieldLabels.orderReference, value: vars.orderReference },
  { label: s.fieldLabels.email, value: vars.email },
];

export const renderWithdrawalStoreNotice: MailTemplate<WithdrawalVars> = (ctx, vars) => {
  const s = getWithdrawalStrings(ctx.locale);
  return {
    subject: s.subjectStoreNotice,
    ...renderFormEmail({
      ctx,
      heading: s.storeNotice.heading,
      intro: s.storeNotice.intro,
      formType: s.formType,
      fields: fields(vars, s),
      submittedAt: vars.submittedAt,
    }),
  };
};

export const renderWithdrawalAck: MailTemplate<WithdrawalVars> = (ctx, vars) => {
  const s = getWithdrawalStrings(ctx.locale);
  return {
    subject: s.subjectConsumerAck,
    ...renderFormEmail({
      ctx,
      heading: s.consumerAck.heading,
      intro: s.consumerAck.intro,
      formType: s.formType,
      fields: fields(vars, s),
      submittedAt: vars.submittedAt,
    }),
  };
};
```

The two templates repeat the `formType`/`fields`/`submittedAt` lines. Deliberate: the first draft's shared `formMail(ctx, vars, s, subject, heading, intro)` helper threaded six positional parameters to save three duplicated lines, and existed mostly to bridge ctx onto the renderer's old flat signature. With `ctx` passed through as-is, each template reads standalone; extract a helper if and when a third withdrawal mail appears.

**Design note — why typed self-rendering templates, not a stringly-typed layout-agnostic engine.** A fully generic engine would have templates return an untyped `Record<string, unknown>` token bag and have some engine fill an arbitrary layout. With exactly one layout today, that trades away type safety for generality we don't need. Instead each layout keeps a typed renderer (`renderFormEmail`), and a template is a typed function that calls the right renderer and attaches its subject. A new layout adds a new compiled export + a new typed renderer; new mails add new templates. This generalizes the layer that actually varies (message definitions) without pretending to a generality the layouts don't yet require.

**Design note — why no facade.** The first draft of this spec added `renderMail(template, ctx, vars)` plus a `createMailer(transport, ctx)` facade whose `sendMail({ template, vars, to, from, retries })` rendered and sent in one call. That layer's entire job was to call the template *for* the caller, and it cost real API surface: `renderMail` was a literal one-line pass-through, and making the facade generic over template vars dragged `MailTemplate<Vars>`, `SendMailOptions<Vars>`, and the generic function type `SendMail` into the public API. The caller invoking the template and spreading the result is one expression:

```ts
await sendMail({ ...renderWithdrawalAck(ctx, vars), to, from }, { retries: 1 });
```

`MailMessage`'s required fields (`subject`/`html`/`text`) make the compiler enforce render-before-send at the spread, so no safety is lost. Previewing a mail without sending it is just calling the template — no seam needed. If a future consumer demonstrates a need for one-call ergonomics, a facade can be layered on top of these primitives then, designed against a real second data point instead of a hypothetical one.

### Composable — `server/utils/useMailer.ts` (new, auto-imported)

A thin Nuxt-coupled composable does the config→transport→context wiring so action handlers don't. It **cannot** live in `mail/` (that layer is deliberately Nuxt-free — "no `#imports`, no Nuxt/Nitro globals"), so it goes in `runtime/server/utils/` and composes the pure primitives:

```ts
import { useRuntimeConfig } from '#imports';
import { name } from '../../../../package.json';
import { sendMail, type SendOptions } from '../mail/delivery';
import { resolveTransport } from '../mail/transport/resolveTransport';
import type { MailRenderContext } from '../mail/template/types';
import type { MailerConfig, MailMessage, SendResult } from '../mail/transport/types';

/** Reads the private mailer config and returns a transport-bound sender, the render
 *  context, and the config (for addressing). */
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
```

- **Takes no `event`** — `useRuntimeConfig()` without an event returns the shared runtime config, resolved once at module init with env already applied. That is how laioutr projects run in production today (Node-based hosting; env is present at init), and the private mailer config is identical for every request anyway. The *mechanism* matters: this works because of module-init env application, **not** AsyncLocalStorage event resolution (nitropack does none — an earlier draft claimed otherwise). If a preset that applies env per request (e.g. Cloudflare bindings) ever becomes a target, `event` must be threaded through here — recorded, not built.
- Returns `{ sendMail, ctx, config }`: `sendMail` is the delivery primitive with the transport bound; `ctx` is what templates take; `config` still supplies addressing (`recipient` / `from` / `replyToConsumer`), which no generic layer can own. One call gives the action everything.
- `locale` is passed in (request data via `clientEnv.locale`, not in `runtimeConfig`); everything in config (transport, brand, timezone) is auto-read.

Registered for auto-import in `module.ts` setup (the module registers no server imports today):

```ts
import { addServerImportsDir, createResolver, defineNuxtModule, installModule } from '@nuxt/kit';
// …inside setup():
addServerImportsDir(resolveRuntimeModule('server/utils'));
```

Ambient server utils are how consumers use an essentials module's helpers — the auto-import *is* the delivery mechanism for `useMailer`, and the module's own action resolves it from `#imports` like any consumer would.

`useMailer` is Nuxt-runtime glue (untested, like the action), but the tested seam beneath it — `sendMail` with a fake transport, the templates, `resolveTransport` — carries the coverage.

### Orchestration — `orchestr/legal/withdrawal.action.ts` (rewritten)

```ts
import { useMailer } from '#imports';
import { WithdrawalAction } from '@laioutr-core/canonical-types/ecommerce';
import { renderWithdrawalStoreNotice, renderWithdrawalAck } from '../../mail/withdrawal/templates';
import { getWithdrawalStrings } from '../../mail/withdrawal/strings';
import { defineEssentialsMailerAction } from '../../middleware';

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
    console.error('[essentials-mailer] withdrawal store notice failed', error);
    return { success: false, message: getWithdrawalStrings(locale).errors.deliveryFailed };
  }

  // 2. Consumer acknowledgement — best-effort: deferred past the response, retried, failure logged.
  event.waitUntil(
    sendMail({ ...renderWithdrawalAck(ctx, vars), to: input.email, from: config.from }, { retries: 1 }).catch(
      (error) => console.error('[essentials-mailer] withdrawal consumer acknowledgement failed', error),
    ),
  );

  return { success: true };
});
```

## Behavior and error handling

### Per-attempt timeout

`pTimeout` races each `transport.send` attempt against `timeout` ms. Two deliberate consequences:

- **A timed-out attempt is not retried.** `pTimeout` throws a `TimeoutError`, which has no `.code`, so `shouldRetry` returns `false` and the loop stops. `pTimeout` races but cannot cancel the underlying send, so the message may still be delivered after we give up; not retrying preserves the "never risk a duplicate send" guarantee. The timeout's value here is bounding latency (fail fast instead of hanging the request), not buying another attempt.
- **nodemailer's own `ETIMEDOUT`** (phase timeout, pre-delivery) remains retryable via the code set, distinct from the wrapper's per-attempt `TimeoutError`. The connection-phase timeouts set in `createSmtpTransport` (see above) are what make this path actually reachable: they fire below the wrapper for single-phase hangs, so a hung connect/DNS/greeting gets its retry while anything past the connection phase falls to the non-retryable wrapper.

### Deferred best-effort acknowledgement (`waitUntil`)

The action handler's `event` is an `H3Event` that Nitro augments with `waitUntil` (attached at runtime by nitropack; confirmed in `@laioutr-core` orchestr `actionRunner` that the event is passed through as-is). The consumer acknowledgement is registered with `event.waitUntil` rather than awaited:

- On a long-running Node server it lets the response return before the ack settles.
- On serverless/edge it keeps the invocation alive until the ack (and its retry) completes, instead of the promise being frozen/killed after the response.

This removes the ack and its retry from the response critical path, so `retries: 1` on the ack costs the user no latency. Ack failure is caught and logged; it never affects the returned result.

### Retry budgets

- **Store notice** — `retries: 1`, awaited. Terminal failure returns `{ success: false, message: strings.errors.deliveryFailed }`.
- **Consumer acknowledgement** — `retries: 1`, deferred. An ack duplicate is harmless and the ack is a legally-meaningful durable-medium confirmation, so a cheap retry on a transient blip is worthwhile; terminal failure is logged and swallowed.

### Residual notes

- **Duplicate-send window.** "Unambiguously pre-delivery" is inherited from the existing classifier and is slightly optimistic for socket-level drops (`ESOCKET`/`ETIMEDOUT` can in principle fire after the server buffered `DATA`). This refactor does not change that code set; true at-most-once delivery (message-id dedup / idempotency keys) is out of scope.
- **The classifier is transport-family knowledge.** `RETRYABLE_SMTP_CODES` is a set of **nodemailer** error codes — the classifier is universal *across messages*, not across transport families. An HTTP-API provider (SES, Resend) would signal transience differently (429/5xx), and `delivery.ts` as written would retry none of it. With exactly one transport family, keeping the classifier inside `delivery.ts` is the right simplicity call. The designated evolution path, if a second transport family arrives, is an optional `isTransientError?(error: unknown): boolean` capability on `MailTransport` (falling back to the SMTP classifier): "what does this error mean" moves to the layer that knows, while "how many attempts is this message worth" stays at the call site. Not built now — recorded so it isn't rediscovered.

## Public API changes (`mail/index.ts`)

Add:

- `sendMail` and type `SendOptions` — from `./delivery`. Replaces the v1 `sendMail(config, message)` free function (new signature: transport instead of config, plus policy). Breaking to the v1 surface, acceptable pre-release.
- Types `MailRenderContext`, `FormEmailLink` — from `./template/types` (referenced by the exported `RenderFormEmailOptions`).

Keep:

- `renderFormEmail` and types `FormEmailField`, `RenderFormEmailOptions`, `RenderedEmail` — with `RenderFormEmailOptions` reshaped to `ctx` + content (the v1 `shell` field and the five separate locale/brand fields are gone).

Remove:

- The old `./sendMail` module (superseded as above).
- `getShell` and `type ShellKey` — the layout registry is deleted, not renamed; layouts are owned by their renderers, not looked up by key. External consumers call `renderFormEmail(opts)` with no layout hoop.

Deliberately **not** exported:

- `isTransientSmtpError` and the retryable-code set — internal to `delivery.ts` (principle 1).
- `RenderedMail` and `MailTemplate` — internal authoring types; nothing exported consumes them.
- Withdrawal templates — domain-specific, stay internal.
- `useMailer` — not part of `mail/index.ts` (that entry is Nuxt-free by contract). It is exposed via server auto-import instead (`addServerImportsDir`), so consumers get it ambiently and the module's own action resolves it from `#imports`.

Every export is a compatibility commitment; the surface stays sized to demonstrated needs, not anticipated ones.

## Files

**New**

- `src/runtime/server/mail/delivery.ts`
- `src/runtime/server/mail/template/types.ts`
- `src/runtime/server/mail/withdrawal/templates.ts`
- `src/runtime/server/utils/useMailer.ts`
- `test/delivery.test.ts`
- `test/withdrawal-templates.test.ts`

**Modified**

- `scripts/build-emails.mjs` — emit `<name>Layout` instead of `<name>Shell`.
- `src/runtime/emails/compiled/form-email.ts` — regenerated (`formEmailLayout`).
- `src/runtime/server/mail/template/renderFormEmail.ts` — imports `formEmailLayout` directly (no `shell`/`layout` option), takes `ctx: MailRenderContext`, module-scope compile (cache `Map` + `compileShell` deleted), comments.
- `src/runtime/server/mail/transport/smtp.ts` — internal connection-phase timeouts (`dnsTimeout`/`connectionTimeout`/`greetingTimeout` = 8s).
- `src/runtime/server/mail/index.ts` — export changes above.
- `src/runtime/server/orchestr/legal/withdrawal.action.ts` — orchestration dissolved in, wired via the auto-imported `useMailer`.
- `src/module.ts` — add `addServerImportsDir(resolveRuntimeModule('server/utils'))` so `useMailer` is auto-imported.
- `package.json` — add `p-timeout` (ESM; pin the current major, ^7, alongside `p-retry` ^8).
- `README.md` — documents the old surface throughout (`sendMail(config, message)`, `getShell`, "shells", the key-addressed-renderer extensibility bullet): update to the new API and the typed-renderer-per-layout story.
- `test/render-form-email.test.ts` — fixture shell deleted; runs against the real compiled layout (see Testing); options updated to `ctx` + content.
- `test/compiled-shell.test.ts` → **renamed** `compiled-layout.test.ts`, imports `formEmailLayout`.
- `test/transport.test.ts` — assert `createSmtpTransport` sets the connection-phase timeouts.

**Deleted**

- `src/runtime/server/mail/template/shells.ts` (the layout registry — deleted, not renamed to `layouts.ts`)
- `src/runtime/server/mail/withdrawal/handleWithdrawal.ts`
- `src/runtime/server/mail/sendMail.ts`
- `test/handle-withdrawal.test.ts`
- `test/send-mail.test.ts`

**Unchanged**

- `src/runtime/server/mail/withdrawal/strings.ts` (consumed by templates + the action).
- `emails/form-email.vue`, `maizzle.config.mjs`, `components/EssentialsLayout.vue`.
- `transport/types.ts`, `transport/resolveTransport.ts`, `i18n.ts`.

## Testing

The reusable layers carry the coverage `handleWithdrawal` tests provided:

`test/delivery.test.ts` — `sendMail`:

- Retries once on a transient code (`ECONNECTION`) then succeeds.
- Aborts (no retry) on a non-transient code (`EENVELOPE`).
- Defaults to a single attempt when `options` is omitted.
- Per-attempt timeout: a hung send rejects with a timeout and is **not** retried (short `timeout`, hanging transport).
- The fake transport receives the message unchanged (envelope passthrough).
- The 500ms backoff is crossed with `vi.useFakeTimers()` + `advanceTimersByTimeAsync` (p-retry's backoff is a plain `setTimeout`) — backoff is deliberately not a public knob.

`test/render-form-email.test.ts` — now runs against the **real compiled `formEmailLayout`** instead of a hand-maintained fixture. What transfers as-is: heading/intro/field values, chrome labels, date + timezone strings, escaping, plaintext derivation. What must **re-anchor** to the real markup (the first draft's "assertions otherwise unchanged" was wrong): the exact `<html lang dir>` substring (the real tag carries xmlns attributes), link assertions (real anchors carry inline style attributes), the `·` separator (the real HTML uses the `&middot;` entity), the `<nav>`-absence check (the real layout never had a `<nav>` — that assertion was vacuous even against the fixture), and the field-row count. The move *strengthens* coverage: with the fixture, renderer↔layout token drift stayed green (a dropped token renders as an empty string — no leftover `{{`); against the real artifact it fails a test directly.

`test/withdrawal-templates.test.ts` — `renderWithdrawalStoreNotice` / `renderWithdrawalAck`:

- Correct subject per template and per content language (de/en).
- `html` contains the heading/intro and the three field labels + values.
- `ctx` threads through: `shopName` appears in the output; `timeZone`/`locale` drive the `submittedAt` formatting.
- Re-covers the withdrawal copy/field mapping the deleted handler tests exercised.

`test/compiled-layout.test.ts` — kept (renamed): it pins the build-output contract (every token survives the Maizzle build) independent of renderer behavior, catching a bad regeneration fast.

`test/transport.test.ts` — gains one assertion: `createSmtpTransport` passes the connection-phase timeouts to nodemailer.

There is no facade test because there is no facade: the primitive's options are tested in `delivery.test.ts`, and templates are pure functions tested by calling them.

## Explicit tradeoff

Dissolving `handleWithdrawal` removes its pure-orchestrator unit tests. The Nuxt-runtime glue — `useMailer` (`#imports`) and `withdrawal.action.ts` (`event.waitUntil`) — is not unit-tested. Two withdrawal behaviors thus lose direct coverage: store-notice reply-to gating (`replyToConsumer === false`) and the deferred best-effort ordering (ack failure does not fail the withdrawal). `useMailer` itself is trivial wiring over the tested `sendMail`/`resolveTransport` primitives plus an object literal, so the uncovered surface is only the action's addressing/orchestration. This is the accepted cost of the "dissolve into the action" decision. If that coverage is later wanted, a Nuxt-runtime action test can add it; out of scope here.
