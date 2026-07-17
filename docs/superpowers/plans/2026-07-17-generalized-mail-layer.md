# Generalized Mail Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the inlined withdrawal retry logic into a reusable `sendMail(transport, message, options)` delivery primitive (with a new per-attempt timeout and SMTP connection-phase timeouts that make the retry actually fire on a hang), turn rendering into typed templates over a layout-owning `renderFormEmail`, expose an auto-imported `useMailer` composable, and dissolve `handleWithdrawal` into its action.

**Architecture:** Two independent layers — **delivery** (`sendMail` with retry/timeout) and **rendering** (templates: `(ctx, vars) => { subject, html, text }`) — that meet at a plain value, `MailMessage = { ...template(ctx, vars), to, from, replyTo }`. No facade calls one on behalf of the other. A thin Nuxt-coupled `useMailer(locale)` composable does the config→transport→context wiring; the action orchestrates the two withdrawal sends on top. Everything under `mail/` is Nuxt-free and unit-tested; `useMailer` and the action are runtime glue.

**Tech Stack:** TypeScript, Nuxt 3 module (Nitro/h3), Vitest, `p-retry` (^8), `p-timeout` (^7, new), Handlebars, Maizzle (build-time), nodemailer.

## Global Constraints

- Runtime: Node `>=22.12.0`, pnpm `>=10.15.0`.
- `mail/index.ts` (the package's `./server` entry) MUST stay Nuxt-free: no `#imports`, no Nuxt/Nitro globals. `useMailer` therefore lives in `server/utils/`, NOT in `mail/`, and is NOT exported from `index.ts`.
- Content languages: German + English only. No new translations.
- Retryable SMTP codes (universal classifier, **internal** — not injectable, not exported): `ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `EDNS`.
- Delivery: the only per-message knobs are `retries` (default 0) and `timeout` (per-attempt, default 10_000 ms; pass 0 to disable). Backoff is a constant internal 500 ms; growth factor is a constant 1. No `minTimeout`/`factor`/`shouldRetry` in the public `SendOptions`.
- A per-attempt `TimeoutError` (from `p-timeout`) has no `.code`, so it is NOT retryable → it aborts. This preserves the no-duplicate-send guarantee.
- SMTP connection-phase timeouts (`dnsTimeout`/`connectionTimeout`/`greetingTimeout`) are set to 8_000 ms in `createSmtpTransport` — below the 10_000 ms per-attempt wrapper — so a hung connect surfaces as nodemailer's retryable `ETIMEDOUT` before the wrapper aborts. `socketTimeout` keeps nodemailer's default (post-DATA inactivity is not safe to retry).
- `useMailer(locale)` takes a plain locale string and NO `event`: `useRuntimeConfig()` returns the module-init shared config (env applied once at init) — valid on laioutr's Node hosting today. This is module-init env application, NOT AsyncLocalStorage.
- `p-timeout` is ESM-only v7 (node ≥20; compatible), API `pTimeout(promise, { milliseconds })`, throws `TimeoutError`.
- Work directly on `main` (repo convention — no branches/worktrees). Commit at the end of each task with a conventional-commit message. These commits are plan-authorized.
- Run commands with pnpm. `pnpm vitest run <path>` runs one test file; `pnpm test` runs `build:emails` then the whole suite. `pnpm dev:prepare` is the typecheck/prepare gate (builds emails, stubs + prepares the module and playground, resolves `#imports`).

---

### Task 1: Delivery primitive (`sendMail` with retry + per-attempt timeout)

Replaces the old low-level `sendMail(config, message)` free function with the resilient primitive of the same public name. The old `./sendMail` module has no internal callers (the action uses `handleWithdrawal`, not this), so it is removed here and its name reclaimed.

**Files:**
- Modify: `package.json` (add `p-timeout`)
- Create: `src/runtime/server/mail/delivery.ts`
- Modify: `src/runtime/server/mail/index.ts` (swap the `sendMail` export source, add `SendOptions`)
- Delete: `src/runtime/server/mail/sendMail.ts`, `test/send-mail.test.ts`
- Test: `test/delivery.test.ts`

**Interfaces:**
- Consumes: `MailMessage`, `MailTransport`, `SendResult` from `./transport/types` (already exist).
- Produces:
  - `sendMail(transport: MailTransport, message: MailMessage, options?: SendOptions): Promise<SendResult>`
  - `interface SendOptions { retries?: number; timeout?: number }`

- [ ] **Step 1: Add the `p-timeout` dependency**

Edit `package.json` — add to `dependencies` (after `p-retry`, keeping the block alphabetical):

```json
    "p-retry": "^8.0.0",
    "p-timeout": "^7.0.1"
```

Then install:

Run: `pnpm install`
Expected: completes; `p-timeout` present in `node_modules` (`node_modules/p-timeout/package.json` shows `"version": "7.x"`).

- [ ] **Step 2: Write the failing test**

Create `test/delivery.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMail } from '../src/runtime/server/mail/delivery';
import type { MailMessage, MailTransport, SendResult } from '../src/runtime/server/mail/transport/types';

const message: MailMessage = {
  from: 'Shop <noreply@example.com>',
  to: 'trader@example.com',
  subject: 'Test',
  html: '<p>hi</p>',
  text: 'hi',
};

const err = (code: string) => Object.assign(new Error(code), { code });

/** Transport whose send() runs per-attempt behavior; records the attempt count. */
function transportOf(behavior: (attempt: number) => Promise<SendResult>): {
  transport: MailTransport;
  attempts: () => number;
} {
  let n = 0;
  return {
    transport: {
      send: () => {
        n += 1;
        return behavior(n);
      },
    },
    attempts: () => n,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sendMail (delivery)', () => {
  it('retries once on a transient code then succeeds', async () => {
    vi.useFakeTimers();
    const { transport, attempts } = transportOf(async (n) => {
      if (n === 1) throw err('ECONNECTION');
      return { messageId: 'ok' };
    });
    const promise = sendMail(transport, message, { retries: 1 });
    await vi.advanceTimersByTimeAsync(600); // cross the internal 500 ms backoff
    await expect(promise).resolves.toEqual({ messageId: 'ok' });
    expect(attempts()).toBe(2);
  });

  it('aborts (no retry) on a non-transient code', async () => {
    const { transport, attempts } = transportOf(async () => {
      throw err('EENVELOPE');
    });
    await expect(sendMail(transport, message, { retries: 3 })).rejects.toThrow('EENVELOPE');
    expect(attempts()).toBe(1);
  });

  it('makes a single attempt when retries defaults to 0', async () => {
    const { transport, attempts } = transportOf(async () => {
      throw err('ECONNECTION');
    });
    await expect(sendMail(transport, message)).rejects.toThrow('ECONNECTION');
    expect(attempts()).toBe(1);
  });

  it('times out a hung attempt and does not retry it', async () => {
    const { transport, attempts } = transportOf(() => new Promise<SendResult>(() => {}));
    await expect(sendMail(transport, message, { retries: 2, timeout: 20 })).rejects.toThrow();
    expect(attempts()).toBe(1);
  });

  it('passes the message through to the transport unchanged', async () => {
    let received: MailMessage | undefined;
    const transport: MailTransport = {
      async send(m) {
        received = m;
        return { messageId: 'ok' };
      },
    };
    await sendMail(transport, message);
    expect(received).toEqual(message);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run test/delivery.test.ts`
Expected: FAIL — cannot resolve `../src/runtime/server/mail/delivery`.

- [ ] **Step 4: Write the implementation**

Create `src/runtime/server/mail/delivery.ts`:

```ts
import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import type { MailMessage, MailTransport, SendResult } from './transport/types';

/** Per-attempt timeout default (ms). Bounds a hung send; does not enable another attempt. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Constant backoff before a retry (ms). Internal — nothing needs to tune it. */
const RETRY_BACKOFF_MS = 500;

/**
 * Transient, unambiguously pre-delivery nodemailer codes — safe to retry (no duplicate send).
 * nodemailer's own ETIMEDOUT is a connection-phase timeout (pre-DATA); it is distinct from the
 * per-attempt TimeoutError thrown by the pTimeout wrapper below, which has no `.code` and is
 * therefore NOT retried. createSmtpTransport sets its connection-phase timeouts below
 * DEFAULT_TIMEOUT_MS so a hung connect surfaces here as a retryable ETIMEDOUT.
 */
const RETRYABLE_SMTP_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS']);

/** Universal across messages (spec principle 1), therefore internal — not injectable, not exported. */
function isTransientSmtpError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return !!code && RETRYABLE_SMTP_CODES.has(code);
}

export interface SendOptions {
  /** Retries after the first attempt. Default 0. */
  retries?: number;
  /** Per-attempt timeout (ms). Default 10_000; pass 0 to disable. */
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
      // A pTimeout TimeoutError has no `.code`, so a timed-out attempt is never retried.
      shouldRetry: ({ error }) => isTransientSmtpError(error),
    },
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run test/delivery.test.ts`
Expected: PASS — all five cases green (the retry case uses fake timers; the timeout case takes ~20 ms).

- [ ] **Step 6: Swap the public export and delete the old module**

Edit `src/runtime/server/mail/index.ts` — replace the line `export { sendMail } from './sendMail';` with:

```ts
export { sendMail } from './delivery';
```

And add, in the type-export block (after the `MailTransport … SmtpTransportConfig` line):

```ts
export type { SendOptions } from './delivery';
```

Then remove the superseded module and its test:

```bash
git rm src/runtime/server/mail/sendMail.ts test/send-mail.test.ts
```

- [ ] **Step 7: Verify nothing else imports the deleted module**

Run: `pnpm exec grep -rn "from './sendMail'\|from '../.*mail/sendMail'\|sendMail.ts" src test`
Expected: no matches.

- [ ] **Step 8: Verify the whole suite still passes**

Run: `pnpm test`
Expected: PASS — existing tests (minus the deleted `send-mail`) plus the five new `delivery` cases.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/runtime/server/mail/delivery.ts src/runtime/server/mail/index.ts test/delivery.test.ts
git commit -m "feat: add resilient sendMail delivery primitive with per-attempt timeout"
```

---

### Task 2: SMTP connection-phase timeouts

Without this, nodemailer's phase-timeout defaults (dns/greeting 30 s, connection 2 min, socket 10 min) all exceed the 10 s per-attempt wrapper, so every hang hits the non-retryable `TimeoutError` first and the retryable-`ETIMEDOUT` path is dead. Setting the connection-phase timeouts below the wrapper makes a pre-DATA hang a fast, retryable `ETIMEDOUT`.

**Files:**
- Modify: `src/runtime/server/mail/transport/smtp.ts`
- Test: `test/transport.test.ts` (extend the existing `createTransport` assertion)

**Interfaces:**
- No signature change. `createSmtpTransport(config: SmtpTransportConfig): MailTransport` unchanged; it now passes connection-phase timeouts to nodemailer.

- [ ] **Step 1: Update the failing test first**

Edit `test/transport.test.ts` — in the `'creates a nodemailer transport from the smtp config'` test, replace the `toHaveBeenCalledWith` object with:

```ts
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      dnsTimeout: 8000,
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/transport.test.ts`
Expected: FAIL — the assertion expects the three timeout keys; `createSmtpTransport` does not pass them yet.

- [ ] **Step 3: Add the connection-phase timeouts**

Edit `src/runtime/server/mail/transport/smtp.ts` — add the constant above `createSmtpTransport` and the three keys to the `createTransport` call:

```ts
import { createTransport } from 'nodemailer';
import type { MailMessage, MailTransport, SendResult, SmtpTransportConfig } from './types';

/**
 * Connection-phase timeouts (ms) — kept below delivery.ts's per-attempt wrapper
 * (DEFAULT_TIMEOUT_MS = 10_000) so a hung connect / DNS / greeting surfaces as nodemailer's
 * retryable ETIMEDOUT before the wrapper's non-retryable TimeoutError fires. socketTimeout keeps
 * nodemailer's default: post-DATA inactivity is not provably pre-delivery, so it is not retried.
 */
const CONNECTION_PHASE_TIMEOUT_MS = 8_000;

/**
 * SMTP transport backed by nodemailer. SMTP is the universal provider abstraction —
 * Resend/SES/Postmark/Brevo all expose SMTP credentials — so this already supports them.
 */
export function createSmtpTransport(config: SmtpTransportConfig): MailTransport {
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
    connectionTimeout: CONNECTION_PHASE_TIMEOUT_MS,
    greetingTimeout: CONNECTION_PHASE_TIMEOUT_MS,
    dnsTimeout: CONNECTION_PHASE_TIMEOUT_MS,
  });

  return {
    async send(message: MailMessage): Promise<SendResult> {
      const info = await transporter.sendMail({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { messageId: info?.messageId };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/transport.test.ts`
Expected: PASS — all `createSmtpTransport` / `resolveTransport` cases green.

- [ ] **Step 5: Verify the whole suite passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/server/mail/transport/smtp.ts test/transport.test.ts
git commit -m "feat: bound SMTP connection-phase timeouts below the per-attempt wrapper"
```

---

### Task 3: Rendering foundation — shared types, layout rename, layout-owning `renderFormEmail`

Renames the compiled "shell" to "layout", deletes the string-keyed layout registry (`getShell`), makes `renderFormEmail` import its one compiled layout directly and compile it once at module scope, and reshapes its options to take the render context as a single `ctx` object. A throwaway adapter keeps the still-present `handleWithdrawal` action compiling; Task 6 deletes it.

**Files:**
- Modify: `scripts/build-emails.mjs` (emit `<name>Layout`; comment)
- Modify: `src/runtime/emails/compiled/form-email.ts` (regenerated → `formEmailLayout`)
- Create: `src/runtime/server/mail/template/types.ts`
- Delete: `src/runtime/server/mail/template/shells.ts`
- Modify: `src/runtime/server/mail/template/renderFormEmail.ts` (owns layout, `ctx` param, module-scope compile)
- Modify: `src/runtime/server/mail/index.ts` (drop `getShell`/`ShellKey`; add `MailRenderContext`/`FormEmailLink`)
- Modify: `src/runtime/server/orchestr/legal/withdrawal.action.ts` (temporary adapter — replaced in Task 6)
- Test: `test/render-form-email.test.ts` (against the real layout, `ctx`, re-anchored assertions)
- Rename+modify: `test/compiled-shell.test.ts` → `test/compiled-layout.test.ts`

**Interfaces:**
- Consumes: `formEmailLayout` from `../../../emails/compiled/form-email`; `resolveEmailLocale` from `../i18n`.
- Produces:
  - `interface FormEmailLink { label: string; url: string }` (in `template/types.ts`)
  - `interface MailRenderContext { locale: string; timeZone?: string; shopName: string; shopUrl?: string; footerLinks?: FormEmailLink[] }` (in `template/types.ts`)
  - `interface RenderedMail { subject: string; html: string; text: string }` and `type MailTemplate<Vars> = (ctx: MailRenderContext, vars: Vars) => RenderedMail` (in `template/types.ts`; internal — not exported from `index.ts`)
  - `renderFormEmail(opts: RenderFormEmailOptions): RenderedEmail` where `RenderFormEmailOptions = { ctx: MailRenderContext; heading: string; intro: string; formType: string; fields: FormEmailField[]; submittedAt: Date }`
  - `interface FormEmailField { label: string; value: string }`, `interface RenderedEmail { html: string; text: string }`

- [ ] **Step 1: Change the build script's export suffix + comment**

Edit `scripts/build-emails.mjs`:

Line ~2 comment — change `HTML shells` to `HTML layouts`:

```js
// Compiles Maizzle email templates to placeholder-preserving HTML layouts at BUILD time.
```

Line ~28 — change the generated-line suffix (`Shell` → `Layout`):

```js
    const out = `// GENERATED by scripts/build-emails.mjs — do not edit.\nexport const ${toCamel(name)}Layout = ${JSON.stringify(html)};\n`;
```

- [ ] **Step 2: Regenerate the compiled layout**

Run: `pnpm build:emails`
Expected: `[build-emails] form-email.vue -> src/runtime/emails/compiled/form-email.ts (...)`. The file now begins `export const formEmailLayout = "..."`.

- [ ] **Step 3: Create the shared render types**

Create `src/runtime/server/mail/template/types.ts`:

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

/** A template's output: everything a MailMessage needs except addressing. Internal. */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** The template convention, named for authoring convenience. Internal — not exported from index. */
export type MailTemplate<Vars> = (ctx: MailRenderContext, vars: Vars) => RenderedMail;
```

- [ ] **Step 4: Delete the layout registry**

The registry only existed to serve `renderFormEmail`'s old injectable layout param; the renderer now imports the compiled layout directly.

```bash
git rm src/runtime/server/mail/template/shells.ts
```

- [ ] **Step 5: Rewrite `renderFormEmail` to own its layout and take `ctx`**

Replace the entire contents of `src/runtime/server/mail/template/renderFormEmail.ts` with:

```ts
import Handlebars from 'handlebars';
import { convert } from 'html-to-text';
import { formEmailLayout } from '../../../emails/compiled/form-email';
import { resolveEmailLocale } from '../i18n';
import type { MailRenderContext } from './types';

export interface FormEmailField {
  label: string;
  value: string;
}

export interface RenderFormEmailOptions {
  /** Config/request-derived context (locale, timezone, brand). The layout is owned here. */
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

/** Row-label chrome the layout itself owns, by language. */
const CHROME = {
  de: { formType: 'Formulartyp', submittedAt: 'Eingegangen am' },
  en: { formType: 'Form type', submittedAt: 'Received at' },
} as const;

/** Compiled once — the layout is a static module constant (Handlebars compiles lazily on import). */
const template = Handlebars.compile(formEmailLayout);

/**
 * Pure: fills the precompiled Maizzle form-email layout with per-request data via Handlebars.
 * Handlebars is a small runtime template engine; its default `{{ }}` escaping HTML-escapes every
 * interpolated value, so callers pass raw strings and untrusted user input can never inject markup.
 */
export function renderFormEmail(opts: RenderFormEmailOptions): RenderedEmail {
  const { ctx } = opts;
  const { contentLanguage, direction, formatLocale, timeZone } = resolveEmailLocale(
    ctx.locale,
    ctx.timeZone,
  );
  const chrome = CHROME[contentLanguage];
  const submittedAt = new Intl.DateTimeFormat(formatLocale, {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone,
  }).format(opts.submittedAt);
  const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(opts.submittedAt);

  const html = template({
    heading: opts.heading,
    intro: opts.intro,
    formType: opts.formType,
    formTypeLabel: chrome.formType,
    submittedAt,
    submittedAtLabel: chrome.submittedAt,
    fields: opts.fields,
    htmlLang: contentLanguage,
    textDirection: direction,
    timeZone,
    shopName: ctx.shopName,
    shopUrl: ctx.shopUrl,
    footerLinks: ctx.footerLinks,
    year,
  });

  const text = convert(html, { wordwrap: false });
  return { html, text };
}
```

- [ ] **Step 6: Rewrite the render-form-email test against the real layout**

The hand-maintained fixture is gone; the test now exercises the real compiled `formEmailLayout` that `renderFormEmail` imports. Replace the entire contents of `test/render-form-email.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { renderFormEmail } from '../src/runtime/server/mail/template/renderFormEmail';
import type { MailRenderContext } from '../src/runtime/server/mail/template/types';

const ctx: MailRenderContext = {
  locale: 'en-US',
  shopName: 'Example Shop',
  shopUrl: 'https://shop.example',
  footerLinks: [
    { label: 'Imprint', url: 'https://shop.example/imprint' },
    { label: 'Privacy', url: 'https://shop.example/privacy' },
  ],
};

const base = {
  ctx,
  heading: 'New withdrawal',
  intro: 'A new withdrawal has been submitted.',
  formType: 'Withdrawal',
  fields: [
    { label: 'Name', value: 'Alice Example' },
    { label: 'Order reference', value: 'ORD-42' },
    { label: 'Email address', value: 'alice@example.com' },
  ],
  submittedAt: new Date('2026-07-06T10:30:00Z'),
};

/** base with ctx fields overridden. */
const withCtx = (over: Partial<MailRenderContext>) => ({ ...base, ctx: { ...ctx, ...over } });

describe('renderFormEmail', () => {
  it('substitutes scalars, renders a row per field via the loop, and resolves every token', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('New withdrawal');
    expect(html).toContain('A new withdrawal has been submitted.');
    expect(html).toContain('Withdrawal');
    for (const f of base.fields) {
      expect(html).toContain(f.label);
      expect(html).toContain(f.value);
    }
    // One value cell per field — the {{#each}} loop ran. Only field value cells are right-aligned.
    expect(html.match(/text-align: right/g)).toHaveLength(base.fields.length);
    expect(html).not.toContain('{{');
  });

  it('formats submittedAt in UTC by default and uses English metadata and chrome', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('lang="en" dir="ltr"');
    expect(html).toContain('xml:lang="en" dir="ltr"');
    expect(html).toContain('July 6, 2026 at 10:30:00 AM');
    expect(html).toContain('(UTC)');
    expect(html).toContain('Form type');
    expect(html).toContain('Received at');
  });

  it('uses German metadata and chrome for a de locale', () => {
    const { html } = renderFormEmail(withCtx({ locale: 'de-DE' }));
    expect(html).toContain('lang="de" dir="ltr"');
    expect(html).toContain('xml:lang="de" dir="ltr"');
    expect(html).toContain('Formulartyp');
    expect(html).toContain('Eingegangen am');
  });

  it('uses English copy metadata for an unsupported content language', () => {
    const { html } = renderFormEmail(withCtx({ locale: 'fr-FR' }));
    expect(html).toContain('lang="en" dir="ltr"');
    expect(html).toContain('Form type');
    expect(html).toContain('Received at');
  });

  it('formats the timestamp in a configured canonical IANA timezone', () => {
    const { html } = renderFormEmail(withCtx({ timeZone: 'europe/berlin' }));
    expect(html).toContain('July 6, 2026 at 12:30:00 PM');
    expect(html).toContain('(Europe/Berlin)');
  });

  it('falls back to UTC when the configured timezone is invalid', () => {
    const { html } = renderFormEmail(withCtx({ timeZone: 'Not/AZone' }));
    expect(html).toContain('July 6, 2026 at 10:30:00 AM');
    expect(html).toContain('(UTC)');
  });

  it('derives the copyright year in the effective timezone', () => {
    const { html } = renderFormEmail({
      ...withCtx({ timeZone: 'Europe/Berlin' }),
      submittedAt: new Date('2025-12-31T23:30:00Z'),
    });
    expect(html).toContain('January 1, 2026 at 12:30:00 AM');
    expect(html).toContain('© 2026 Example Shop');
  });

  it('renders the shop-name header (linked) and a footer copyright with the shop name + year', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('href="https://shop.example"'); // header link (exact, no trailing path)
    expect(html).toContain('>Example Shop</a>');
    expect(html).toContain('© 2026 Example Shop');
  });

  it('renders each footer link in order, joined by a separator', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('href="https://shop.example/imprint"');
    expect(html).toContain('href="https://shop.example/privacy"');
    expect(html).toContain('&middot;'); // separator entity between links
    expect(html.indexOf('Imprint')).toBeLessThan(html.indexOf('Privacy')); // order preserved
  });

  it('omits the footer link section when no links are configured, keeping header + copyright', () => {
    const { html } = renderFormEmail(withCtx({ footerLinks: undefined }));
    expect(html).not.toContain('href="https://shop.example/imprint"');
    expect(html).toContain('Example Shop'); // header + copyright still present
    expect(html).not.toContain('{{');
  });

  it('renders the shop name as plain text (no link) when shopUrl is omitted', () => {
    const { html } = renderFormEmail(withCtx({ shopUrl: undefined }));
    expect(html).toContain('>Example Shop</span>'); // styled span, not an anchor
    expect(html).not.toContain('href="https://shop.example"'); // no header link (footer paths differ)
  });

  it('HTML-escapes user-supplied values (Handlebars default escaping)', () => {
    const { html } = renderFormEmail({
      ...base,
      fields: [{ label: 'Name', value: 'Müller & <script>x</script>' }],
    });
    expect(html).toContain('Müller &amp; &lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('inserts values containing "$" literally (no regex-replacement mangling)', () => {
    const { html } = renderFormEmail({
      ...base,
      fields: [{ label: 'Amount', value: 'Total $5 & $&later' }],
    });
    expect(html).toContain('Total $5 &amp; $&amp;later');
  });

  it('derives plaintext with no HTML tags', () => {
    const { text } = renderFormEmail(base);
    expect(text).toContain('Alice Example');
    expect(text).not.toMatch(/<[a-z]/i);
  });
});
```

- [ ] **Step 7: Rename and update the compiled test**

```bash
git mv test/compiled-shell.test.ts test/compiled-layout.test.ts
```

Replace the entire contents of `test/compiled-layout.test.ts` with (import + every `formEmailShell` → `formEmailLayout`, describe label updated):

```ts
import { describe, expect, it } from 'vitest';
import { formEmailLayout } from '../src/runtime/emails/compiled/form-email';

describe('compiled form-email layout', () => {
  it('preserves every runtime scalar placeholder', () => {
    for (const token of [
      '{{heading}}',
      '{{intro}}',
      '{{formType}}',
      '{{formTypeLabel}}',
      '{{submittedAt}}',
      '{{submittedAtLabel}}',
      '{{htmlLang}}',
      '{{textDirection}}',
      '{{timeZone}}',
    ]) {
      expect(formEmailLayout).toContain(token);
    }
  });

  it('preserves the Handlebars fields loop (runtime {{#each}}, not a build-time Vue v-for)', () => {
    for (const token of ['{{#each fields}}', '{{label}}', '{{value}}', '{{/each}}']) {
      expect(formEmailLayout).toContain(token);
    }
  });

  it('preserves the brand header/footer tokens (runtime {{#if}} / {{#each footerLinks}})', () => {
    for (const token of [
      '{{shopName}}',
      '{{#if shopUrl}}',
      'href="{{shopUrl}}"',
      '{{#if footerLinks}}',
      '{{#each footerLinks}}',
      'href="{{url}}"',
      '{{#unless @last}}',
      '{{year}}',
    ]) {
      expect(formEmailLayout).toContain(token);
    }
  });

  it('preserves runtime language and direction metadata in every Maizzle wrapper', () => {
    expect(formEmailLayout).toContain('<html lang="{{htmlLang}}" dir="{{textDirection}}"');
    expect(formEmailLayout).toContain('<body xml:lang="{{htmlLang}}" dir="{{textDirection}}"');
    expect(formEmailLayout).toContain(
      'role="article" aria-roledescription="email" lang="{{htmlLang}}" dir="{{textDirection}}"',
    );
  });

  it('has inlined styles (Maizzle CSS inlining ran)', () => {
    expect(formEmailLayout).toMatch(/style="/);
  });
});
```

- [ ] **Step 8: Update the public exports**

Edit `src/runtime/server/mail/index.ts`:

Remove the value export line `export { getShell } from './template/shells';` and the type export line `export type { ShellKey } from './template/shells';`.

Add a type export line for the new shared types:

```ts
export type { MailRenderContext, FormEmailLink } from './template/types';
```

After these edits the file reads exactly:

```ts
// Server-only public API for the essentials mail backbone.
// Imported by consumers via `@laioutr/app-essentials-mailer/server`. No `#imports`,
// no Nuxt/Nitro globals, no withdrawal specifics — just the reusable transport,
// renderer, and send primitives future essentials apps compose.
export { createSmtpTransport } from './transport/smtp';
export { resolveTransport } from './transport/resolveTransport';
export { renderFormEmail } from './template/renderFormEmail';
export { sendMail } from './delivery';

export type { MailTransport, MailMessage, SendResult, MailerConfig, SmtpTransportConfig } from './transport/types';
export type { SendOptions } from './delivery';
export type { FormEmailField, RenderFormEmailOptions, RenderedEmail } from './template/renderFormEmail';
export type { MailRenderContext, FormEmailLink } from './template/types';
```

- [ ] **Step 9: Keep the withdrawal action compiling (temporary)**

`renderFormEmail`'s signature changed and `getShell` is gone; the still-present `handleWithdrawal` action must keep type-checking until Task 6 replaces it. Edit `src/runtime/server/orchestr/legal/withdrawal.action.ts`:

Remove the `import { getShell } from '../../mail/template/shells';` line and the `const shell = getShell('form-email');` line. Change the `renderEmail` adapter to bridge the handler's flat props onto the new `ctx` shape. The relevant part of the file becomes:

```ts
export default defineEssentialsMailerAction(WithdrawalAction, async ({ input, clientEnv, event }) => {
  const config = useRuntimeConfig(event)[name] as MailerConfig;
  return handleWithdrawal({
    input,
    locale: clientEnv.locale,
    config,
    transport: resolveTransport(config),
    // Temporary bridge — this whole file is replaced in Task 6.
    renderEmail: ({ locale, timeZone, shopName, shopUrl, footerLinks, ...rest }) =>
      renderFormEmail({ ctx: { locale, timeZone, shopName, shopUrl, footerLinks }, ...rest }),
    now: () => new Date(),
  });
});
```

(`rest` is `heading`/`intro`/`formType`/`fields`/`submittedAt` — exactly the non-ctx half of `RenderFormEmailOptions`.)

- [ ] **Step 10: Verify the suite passes and no "shell" naming remains**

Run: `pnpm test`
Expected: PASS — `render-form-email` (14 cases) and `compiled-layout` (5 cases) green.

Run: `pnpm exec grep -rin "shell" src test scripts`
Expected: no matches.

- [ ] **Step 11: Verify the module still typechecks (the temporary bridge included)**

Run: `pnpm dev:prepare`
Expected: completes without error.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: rename email shell to layout and give renderFormEmail its layout + ctx"
```

---

### Task 4: Withdrawal templates

Two typed templates that map withdrawal vars + context to `{ subject, html, text }` via `renderFormEmail`. Each is self-contained (no shared helper); the repeated `formType`/`fields`/`submittedAt` lines are deliberate.

**Files:**
- Create: `src/runtime/server/mail/withdrawal/templates.ts`
- Test: `test/withdrawal-templates.test.ts`

**Interfaces:**
- Consumes: `renderFormEmail`, `FormEmailField` from `../template/renderFormEmail` (Task 3); `getWithdrawalStrings`, `WithdrawalStrings` from `./strings`; `MailTemplate` from `../template/types` (Task 3).
- Produces:
  - `interface WithdrawalVars { name: string; orderReference: string; email: string; submittedAt: Date }`
  - `renderWithdrawalStoreNotice: MailTemplate<WithdrawalVars>`
  - `renderWithdrawalAck: MailTemplate<WithdrawalVars>`

- [ ] **Step 1: Write the failing test**

Create `test/withdrawal-templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  renderWithdrawalAck,
  renderWithdrawalStoreNotice,
  type WithdrawalVars,
} from '../src/runtime/server/mail/withdrawal/templates';
import type { MailRenderContext } from '../src/runtime/server/mail/template/types';

const ctx = (locale: string): MailRenderContext => ({ locale, shopName: 'Example Shop' });

const vars: WithdrawalVars = {
  name: 'Alice Example',
  orderReference: 'ORD-42',
  email: 'alice@example.com',
  submittedAt: new Date('2026-07-06T10:30:00Z'),
};

describe('withdrawal templates', () => {
  it('store notice: English subject + heading/intro + all fields + shopName in the body', () => {
    const { subject, html, text } = renderWithdrawalStoreNotice(ctx('en-US'), vars);
    expect(subject).toBe('New withdrawal received');
    expect(html).toContain('New withdrawal');
    expect(html).toContain('A new withdrawal has been submitted');
    expect(html).toContain('Alice Example');
    expect(html).toContain('ORD-42');
    expect(html).toContain('alice@example.com');
    expect(html).toContain('Example Shop'); // ctx threads through
    expect(html).not.toContain('{{');
    expect(text).toContain('Alice Example');
  });

  it('consumer ack: English subject + heading + intro', () => {
    const { subject, html } = renderWithdrawalAck(ctx('en-US'), vars);
    expect(subject).toBe('Confirmation of your withdrawal');
    expect(html).toContain('Confirmation of your withdrawal');
    expect(html).toContain('We confirm receipt of your withdrawal');
  });

  it('localizes subject + field labels for a German locale', () => {
    const { subject, html } = renderWithdrawalStoreNotice(ctx('de-DE'), vars);
    expect(subject).toBe('Neuer Widerruf eingegangen');
    expect(html).toContain('Bestellnummer');
    expect(html).toContain('E-Mail-Adresse');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/withdrawal-templates.test.ts`
Expected: FAIL — cannot resolve `../src/runtime/server/mail/withdrawal/templates`.

- [ ] **Step 3: Write the implementation**

Create `src/runtime/server/mail/withdrawal/templates.ts`:

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/withdrawal-templates.test.ts`
Expected: PASS. (Uses the real compiled `form-email` layout, present on disk since Task 3.)

- [ ] **Step 5: Verify the whole suite passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/server/mail/withdrawal/templates.ts test/withdrawal-templates.test.ts
git commit -m "feat: add withdrawal mail templates"
```

---

### Task 5: `useMailer` composable + auto-import registration

A thin Nuxt-coupled composable that reads the private config and returns a transport-bound sender, the render context, and the config for addressing. It is auto-imported so consumers (and this module's own action) resolve it from `#imports`.

**Files:**
- Create: `src/runtime/server/utils/useMailer.ts`
- Modify: `src/module.ts` (register the server-imports dir)

**Interfaces:**
- Consumes: `useRuntimeConfig` from `#imports`; `name` from `../../../../package.json`; `sendMail`, `SendOptions` from `../mail/delivery` (Task 1); `resolveTransport` from `../mail/transport/resolveTransport`; `MailRenderContext` from `../mail/template/types` (Task 3); `MailerConfig`, `MailMessage`, `SendResult` from `../mail/transport/types`.
- Produces:
  - `useMailer(locale: string): { sendMail: (message: MailMessage, options?: SendOptions) => Promise<SendResult>; ctx: MailRenderContext; config: MailerConfig }`

Notes: `useMailer` takes a plain `locale` string and no `event` (see Global Constraints — event-less `useRuntimeConfig()` is valid on this hosting). It is Nuxt-runtime glue over the already-tested `sendMail` / `resolveTransport` primitives plus an object literal, so it carries no unit test; it is verified by `pnpm dev:prepare`.

- [ ] **Step 1: Create the composable**

Create `src/runtime/server/utils/useMailer.ts`:

```ts
import { useRuntimeConfig } from '#imports';
import { name } from '../../../../package.json';
import { sendMail, type SendOptions } from '../mail/delivery';
import { resolveTransport } from '../mail/transport/resolveTransport';
import type { MailRenderContext } from '../mail/template/types';
import type { MailerConfig, MailMessage, SendResult } from '../mail/transport/types';

/** Reads the private mailer config and returns a transport-bound sender, the render context,
 *  and the config (for addressing). No `event`: `useRuntimeConfig()` returns the module-init
 *  shared config (env applied once at init), which is correct on this Node hosting. */
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

- [ ] **Step 2: Register the server-imports directory**

Edit `src/module.ts`:

Add `addServerImportsDir` to the `@nuxt/kit` import (line ~2):

```ts
import { addServerImportsDir, createResolver, defineNuxtModule, installModule } from '@nuxt/kit';
```

Inside `setup`, after `nuxt.options.build.transpile.push(resolve('./runtime'));`, add:

```ts
    addServerImportsDir(resolveRuntimeModule('server/utils'));
```

- [ ] **Step 3: Verify the module prepares and typechecks**

Run: `pnpm dev:prepare`
Expected: completes without error — resolves `#imports`, the new composable, and the registration.

Run: `pnpm test`
Expected: PASS (unchanged suite — no test imports `useMailer`).

- [ ] **Step 4: Commit**

```bash
git add src/runtime/server/utils/useMailer.ts src/module.ts
git commit -m "feat: add auto-imported useMailer composable"
```

---

### Task 6: Dissolve `handleWithdrawal` into the action + docs cleanup

Replaces the DI-heavy `handleWithdrawal` orchestrator with a thin action that composes `useMailer` + the two templates + `sendMail`, and brings the README in line with the new public API.

**Files:**
- Rewrite: `src/runtime/server/orchestr/legal/withdrawal.action.ts`
- Delete: `src/runtime/server/mail/withdrawal/handleWithdrawal.ts`, `test/handle-withdrawal.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `useMailer` from `#imports` (Task 5); `renderWithdrawalStoreNotice`, `renderWithdrawalAck` from `../../mail/withdrawal/templates` (Task 4); `getWithdrawalStrings` from `../../mail/withdrawal/strings`; `defineEssentialsMailerAction` from `../../middleware`; `WithdrawalAction` from `@laioutr-core/canonical-types/ecommerce`.
- Produces: the registered `WithdrawalAction` handler (the app's HTTP behavior).

- [ ] **Step 1: Rewrite the action handler**

Replace the entire contents of `src/runtime/server/orchestr/legal/withdrawal.action.ts` with:

```ts
import { useMailer } from '#imports';
import { WithdrawalAction } from '@laioutr-core/canonical-types/ecommerce';
import { renderWithdrawalStoreNotice, renderWithdrawalAck } from '../../mail/withdrawal/templates';
import { getWithdrawalStrings } from '../../mail/withdrawal/strings';
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

- [ ] **Step 2: Delete the superseded orchestrator and its test**

```bash
git rm src/runtime/server/mail/withdrawal/handleWithdrawal.ts test/handle-withdrawal.test.ts
```

- [ ] **Step 3: Verify nothing else references the deleted symbol**

Run: `pnpm exec grep -rn "handleWithdrawal" src test`
Expected: no matches.

- [ ] **Step 4: Update the README's Server API section**

Edit `README.md` — in the `## Server API` code block, drop `getShell` from the import:

```ts
import {
  sendMail,
  resolveTransport,
  renderFormEmail,
  createSmtpTransport,
} from '@laioutr/app-essentials-mailer/server'
```

Replace the bullet list under it with:

```markdown
- `sendMail(transport, message, options?)` — send one fully-addressed message with retry + per-attempt timeout policy (`{ retries?, timeout? }`).
- `resolveTransport(config)` / `createSmtpTransport(smtp)` — the transport seam.
- `renderFormEmail(opts)` — fill the compiled form-email layout with per-request data → `{ html, text }`.
```

- [ ] **Step 5: Update the README's "How emails are authored" + Extensibility + Development wording**

Edit `README.md`:

In `## How emails are authored`, change `into HTML "shells" under` to `into HTML **layouts** under`, and `at runtime the shell is filled with` to `at runtime the layout is filled with`.

In `## Extensibility (future)`, replace the `**Key-addressed renderer**` bullet with:

```markdown
- **Typed layout renderers** — each compiled layout has its own typed renderer (`renderFormEmail` for the `form-email` layout); a new layout adds a new renderer, and new messages add new templates over it.
```

And update the `**Shared server API**` bullet's trailing list to `sendMail`, `resolveTransport`, `renderFormEmail` (drop any `getShell`).

In `## Development`, change `regenerates the compiled shells from` to `regenerates the compiled layouts from`.

- [ ] **Step 6: Verify no stale API references remain in docs or code**

Run: `pnpm exec grep -rin "getShell\|shell\|sendMail(config" README.md src test scripts`
Expected: no matches.

- [ ] **Step 7: Verify the full suite passes**

Run: `pnpm test`
Expected: PASS — `delivery`, `transport`, `render-form-email`, `compiled-layout`, `withdrawal-templates`, `withdrawal-strings`, `email-i18n` green; the two deleted test files gone.

- [ ] **Step 8: Verify the module prepares, typechecks, and lints**

Run: `pnpm dev:prepare`
Expected: completes without error (the rewritten action resolves `useMailer` from `#imports` and the templates).

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: dissolve handleWithdrawal into the action via useMailer + templates"
```

---

## Self-Review

**Spec coverage:**
- Delivery `sendMail(transport, message, options)` + internal classifier + `SendOptions {retries, timeout}` + per-attempt timeout via p-retry native `shouldRetry` (no `AbortError`) → Task 1. ✓
- `p-timeout` dependency (^7) → Task 1 Step 1. ✓
- SMTP connection-phase timeouts (8 s, below the 10 s wrapper) so the retryable-`ETIMEDOUT` path is live → Task 2. ✓
- shell→layout rename (build script + comment, compiled export, deleted registry) → Task 3. ✓
- `renderFormEmail` owns its layout (direct import, module-scope compile, no cache Map) and takes `ctx` → Task 3. ✓
- `template/types.ts` with `MailRenderContext`, `RenderedMail`, `MailTemplate`, `FormEmailLink` (internal `RenderedMail`/`MailTemplate`) → Task 3. ✓
- Withdrawal templates `renderWithdrawalStoreNotice`/`renderWithdrawalAck` (no `formMail` helper; ctx spread) → Task 4. ✓
- `useMailer(locale)` in `server/utils/` returning `{ sendMail, ctx, config }`, event-less config, `addServerImportsDir` auto-import → Task 5. ✓
- Action dissolved with `event.waitUntil` best-effort ack + reply-to gating; delete `handleWithdrawal`/`sendMail` + their tests → Tasks 1 (sendMail) and 6 (handleWithdrawal). ✓
- Public API: add `sendMail`/`SendOptions` (Task 1), `MailRenderContext`/`FormEmailLink` (Task 3); remove old `sendMail` module (Task 1) and `getShell`/`ShellKey` (Task 3); `RenderedMail`/`MailTemplate`/`useMailer` deliberately not exported. ✓
- README brought in line with the new surface → Task 6. ✓
- Tests: `delivery.test.ts`, `withdrawal-templates.test.ts` created; `transport.test.ts`, `render-form-email.test.ts` updated; `compiled-shell`→`compiled-layout` renamed; `send-mail`/`handle-withdrawal` deleted. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code and test step shows full content. The one temporary bridge (Task 3 Step 9) shows its complete code and is explicitly removed in Task 6. ✓

**Type consistency:** `MailRenderContext` defined once in `template/types.ts` and consumed by `renderFormEmail` (Task 3), templates (Task 4), and `useMailer` (Task 5); `MailTemplate<Vars>` used identically in Tasks 3–4; `sendMail(transport, message, options)` signature identical across Tasks 1, 5, 6; `SendOptions {retries, timeout}` consistent across Tasks 1 and 5; `renderFormEmail({ ctx, heading, intro, formType, fields, submittedAt })` shape identical across Tasks 3 (renderer + test) and 4 (templates); `WithdrawalVars` (`name`/`orderReference`/`email`/`submittedAt`) consistent across Task 4 and the Task 6 `vars` (which spreads `input` + `submittedAt`); template names `renderWithdrawalStoreNotice`/`renderWithdrawalAck` consistent across Tasks 4 and 6. ✓

**Green at every commit:** Each task ends with `pnpm test` passing; Tasks 3, 5, 6 additionally run `pnpm dev:prepare` where the action/`#imports` are touched. The Task 3 temporary bridge keeps the pre-dissolution action type-checking. ✓

**Explicit tradeoff carried:** `useMailer` and the action are untested Nuxt glue; store-notice reply-to gating (`replyToConsumer === false`) and the deferred best-effort ordering lose direct unit coverage — verified via `pnpm dev:prepare`/`pnpm lint` (documented in the spec's Explicit tradeoff section).
