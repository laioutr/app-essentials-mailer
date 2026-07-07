# Essentials Mailer App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone open-source Nuxt-module app `@laioutr/app-essentials-mailer` — the shared mail backbone for the "essentials apps" family — whose first feature formats a withdrawal-form submission into two emails (store notice + consumer acknowledgement) and sends them via a configurable SMTP transport.

**Architecture:** A Nuxt module scaffolded from `app-starter`. Email HTML is authored once as a **Maizzle template**, compiled to an inlined, email-client-safe **HTML shell at *our* build time** (Maizzle is a build-only dependency) with placeholders left intact; at runtime a **pure string function** substitutes per-request data into the shell and derives plaintext with `html-to-text`, so **consumers ship no email framework at runtime**. Config is stored **private-only** in `runtimeConfig[name]` with **no validation** (deliberate). The withdrawal orchestration (build fields → stamp time → send store notice, then best-effort consumer acknowledgement) is a **pure, dependency-injected function**; the critical store-notice send retries via **`p-retry`** on transient pre-delivery errors only. The transport, renderer, and Maizzle config are structured as **reusable seams** so future essentials apps can contribute their own templates later.

**Tech Stack:** TypeScript, Nuxt module (`@nuxt/kit`, `nuxt-module-build`), `@laioutr-core/kit` (`registerLaioutrApp`), `@laioutr-core/orchestr` (`defineOrchestr`), `@laioutr-core/canonical-types` (`WithdrawalAction` token), `@maizzle/framework` (build-time email compilation), `nodemailer` (SMTP), `html-to-text` (plaintext), `p-retry` (retry), `vitest`. Released via `changelogen` + `npm publish`.

## Scope

This plan covers **only the app repo** (`@laioutr/app-essentials-mailer`) — section **§7** of the design (`plans/2026-07-06-withdrawal-button-essentials-mailer-design.md`), plus decisions taken in the design review that supersede parts of §7 (recorded in **Decisions taken** below). The monorepo work (the `ecommerce/legal/withdrawal` **token**, the UI, and the block — design §4–§6) is a **separate plan** and is **assumed already implemented**. The multi-app template-registration surface is **out of scope** for v1 — v1 builds only the *seams* for it (see **Extensibility (future)**).

## Decisions taken (supersede the design doc where noted)

1. **No config validation.** The design's §7.2 zod-validated-in-`setup` is dropped. Config is plain TS types, merged into `runtimeConfig[name]` **private-only**, no `.parse()`. A typo'd config surfaces as a failed send at request time. (`zod` is therefore not a direct dependency of this app.)
2. **Templating = Maizzle, precompiled.** Supersedes §7.4's "MJML at runtime". Author in Maizzle → compile to an HTML shell at **our** build (Maizzle is a devDependency, never in a consumer's runtime) → runtime template-fill (see Decision 6) + `html-to-text` for plaintext. Chosen because this app is a **distributed module**: runtime renderers (runtime-MJML, vue-email, runtime-Maizzle) would push a heavy render pipeline into every consumer's Nitro; precompiling keeps consumers light while preserving family-grade authoring. Maizzle 6 is Vue-SFC based, so templates are `emails/*.vue` compiled via `render()`, and dynamic tokens are preserved through compilation with `v-pre` (Maizzle's documented `<Raw>` primitive is the equivalent).
3. **Retry = `p-retry`, pre-delivery errors only.** The critical store-notice send retries once (~500 ms backoff) **only** on transient connection errors (`ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `EDNS`); any other error (bad recipient, auth, or anything after the server accepted the message) aborts immediately via `p-retry`'s `AbortError`, to avoid duplicate delivery.
4. **Token is branch-only, not yet published.** Tasks 1–6 do not depend on it. Task 7 (the action handler) is **gated on the token being installable**; keep the version lookup + peer-floor bump there.
5. **Family backbone, seams only.** Build the five forward-compat seams (exportable Maizzle config, key-addressed renderer, configurable template-dir glob, shared server API, reserved registration hook) so multi-app template contribution is an additive change later — do not build the registry now.
6. **Runtime engine = Handlebars** (supersedes the dumb `String.replaceAll` + raw `{{{fields}}}` slot described in Tasks 3 & 4). Research (Maizzle has no native runtime conditionals; the blessed pattern is "leave tokens intact, fill with a downstream engine") plus the family-backbone goal (external apps contribute templates needing runtime `{{#if}}`/`{{#each}}`, which string-replace cannot express) settled on a small runtime engine. **Handlebars** because our placeholders already use `{{ }}` (so existing scalar tokens are valid Handlebars unchanged) and its delimiters are in Maizzle's `css.purge.backend` preserve-defaults. `handlebars` is a **runtime dependency** (ships in the consumer bundle); default `{{ }}` escaping HTML-escapes all interpolated data, so the renderer passes raw values (no manual `escapeHtml`). The variable field list is authored as a real `{{#each fields}}` loop inside a `v-pre` block in `emails/form-email.vue` — **not** a JS-built HTML blob. Compiled templates are cached per shell string. This reshaped Tasks 3 (template), 4 (renderer), and 8 (which re-exports the Handlebars-backed `renderFormEmail`); the string-replace code in those task bodies is historical.

## Prerequisites

- The published `@laioutr-core/canonical-types` must export `WithdrawalAction` from `./ecommerce`. It is **not** on the current branch / registry yet (this repo has `0.24.1`). Tasks 1–6 proceed regardless; **Task 7 blocks** until a token-bearing version is installable (via a prerelease publish, or waiting for the release).
- `.npmrc` must exist (copy `.npmrc.config`, fill `NPM_LAIOUTR_TOKEN`) for `@laioutr-*` installs.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Package name / configKey / runtimeConfig key are the identical literal** `@laioutr/app-essentials-mailer` (monorepo convention: `configKey: name`).
- **Secrets are private-only.** Never write config to `runtimeConfig.public`. SMTP credentials must never reach a client bundle.
- **`@maizzle/framework` is a build-time dependency only.** It is imported exclusively from the build script (`scripts/build-emails.mjs`), never from any `src/runtime/**` file, so it never enters a consumer's server bundle.
- **zod is imported as `import { z } from 'zod/v4'`** *if* ever needed — but this app has no direct zod usage after Decision 1.
- **Node runtime assumed** (full Node.js; edge out of scope) — nodemailer/SMTP fine.
- **No UI.** `registerLaioutrApp` gets only `{ name, version, orchestrDirs }`.
- **Engines:** `node >=22.12.0`, `pnpm >=10.15.0`.
- **TDD + frequent commits**, straight to `main` (no branches).
- **License:** MIT, public `@laioutr/*` npm namespace (publishes to `registry.npmjs.org`).

## File Structure

**Build-time (not shipped to runtime):**
- `maizzle.config.mjs` — the shared Maizzle config (Tailwind theme, transformers, components, content globs). Exportable so future apps compile against the same config.
- `emails/form-email.vue` — the **generic** Maizzle (Vue-SFC) form-email template: styled skeleton with scalar placeholders (`{{heading}}`, `{{intro}}`, `{{formType}}`, `{{formTypeLabel}}`, `{{submittedAt}}`, `{{submittedAtLabel}}`) and a Handlebars `{{#each fields}}` row loop, all `v-pre`-preserved through compilation (Decision 6).
- `scripts/build-emails.mjs` — compiles `emails/*.vue` via Maizzle `render()` into generated runtime modules.

**Created (runtime):**
- `src/config-types.ts` — plain TS config types (`SmtpTransportConfig`, `TransportConfig`, `MailerConfig`, `ModuleOptions`). No zod.
- `src/runtime/emails/compiled/*.ts` — **generated** (gitignored) shell modules, e.g. `form-email.ts` exporting `formEmailShell: string`.
- `src/runtime/server/mail/template/renderFormEmail.ts` — pure shell-interpolation renderer (→ `{ html, text }`).
- `src/runtime/server/mail/template/shells.ts` — key→shell lookup (the key-addressed-renderer seam).
- `src/runtime/server/mail/transport/{types,smtp,resolveTransport}.ts` — transport seam.
- `src/runtime/server/mail/withdrawal/strings.ts` — localized withdrawal copy.
- `src/runtime/server/mail/withdrawal/handleWithdrawal.ts` — pure, injected orchestration (+ `p-retry`).
- `src/runtime/server/mail/sendMail.ts`, `src/runtime/server/mail/index.ts` — server-only public API + barrel.
- `src/runtime/server/middleware/index.ts` — `defineEssentialsMailerAction` shortcut.
- `src/runtime/server/orchestr/legal/withdrawal.action.ts` — thin orchestr action wrapper.
- `test/*.test.ts` — unit tests (transport, renderFormEmail, withdrawal-strings, handle-withdrawal, send-mail, plus a compiled-shell smoke test).

**Modified:** `package.json`, `src/module.ts`, `src/globalExtensions.ts`, `playground/nuxt.config.ts`, `playground/app.vue`, `.gitignore`, `README.md`.

**Deleted:** `src/runtime/app/` (no UI), `test/basic.test.ts` + `test/fixtures/` (starter e2e placeholder).

---

### Task 1: Project identity, config types, and module wiring

Set the app's identity and the corrected module `setup`: private-only config storage, **no validation**, no UI. Remove the starter's e2e placeholder so `pnpm vitest run` is meaningful from here.

**Files:**
- Modify: `package.json`, `src/module.ts`, `src/globalExtensions.ts`
- Create: `src/config-types.ts`
- Delete: `test/basic.test.ts`, `test/fixtures/`, `src/runtime/app/`

**Interfaces — Produces:**
- `interface SmtpTransportConfig { type: 'smtp'; host: string; port: number; secure?: boolean; auth: { user: string; pass: string } }`
- `type TransportConfig = SmtpTransportConfig` (union grows with future providers)
- `interface MailerConfig { transport: TransportConfig; from: string; recipient: string; replyToConsumer?: boolean }`
- `type ModuleOptions = MailerConfig`

- [ ] **Step 1: Update `package.json` identity + trim**

Set: `"name": "@laioutr/app-essentials-mailer"`, `"version": "0.1.0"`, `"description": "Laioutr Essentials Mailer — the shared mail backbone for essentials apps; v1 handles withdrawal-form submissions."`, `"repository": "laioutr/app-essentials-mailer"`, `"license": "MIT"`. In `devDependencies` remove `"@laioutr-app/ui"`. Leave `peerDependencies` unchanged for now.

- [ ] **Step 2: Create config types**

Create `src/config-types.ts`:

```ts
/** SMTP transport connection settings. */
export interface SmtpTransportConfig {
  type: 'smtp';
  host: string;
  port: number;
  secure?: boolean;
  auth: { user: string; pass: string };
}

/** Discriminated by `type`; future providers (resend, postmark, …) add variants. */
export type TransportConfig = SmtpTransportConfig;

/** The private config stored in runtimeConfig[name]. Not validated (by design). */
export interface MailerConfig {
  transport: TransportConfig;
  /** Sender address; may be "Display Name <addr>" form. */
  from: string;
  /** Trader address that receives withdrawal notices. */
  recipient: string;
  /** When not false (default true), the store-notice reply-to is the consumer's email. */
  replyToConsumer?: boolean;
}

/** Module options === the mailer config. */
export type ModuleOptions = MailerConfig;
```

- [ ] **Step 3: Rewrite `src/module.ts`**

```ts
/* eslint-disable @typescript-eslint/no-empty-object-type */
import { createResolver, defineNuxtModule, installModule } from '@nuxt/kit';
import { defu } from 'defu';
import { registerLaioutrApp } from '@laioutr-core/kit';
import { name, version } from '../package.json';
import type { MailerConfig, ModuleOptions } from './config-types';

export type { ModuleOptions };

/** runtimeConfig.public — intentionally empty; secrets stay private. */
export interface RuntimeConfigModulePublic {}
/** runtimeConfig[name] — the mailer config. */
export interface RuntimeConfigModulePrivate extends MailerConfig {}

export default defineNuxtModule<ModuleOptions>({
  meta: { name, version, configKey: name },
  defaults: {},
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);
    const resolveRuntimeModule = (path: string) => resolve('./runtime', path);

    nuxt.options.build.transpile.push(resolve('./runtime'));

    // PRIVATE-only. No validation (by design). Never copied to runtimeConfig.public.
    nuxt.options.runtimeConfig[name] = defu(
      nuxt.options.runtimeConfig[name] as Parameters<typeof defu>[0],
      options,
    );

    await registerLaioutrApp({
      name,
      version,
      orchestrDirs: [resolveRuntimeModule('server/orchestr')],
    });

    if (nuxt.options._prepare) {
      await installModule('@laioutr-core/frontend-core');
      await installModule('@laioutr-core/orchestr');
    }
  },
});
```

- [ ] **Step 4: Update `src/globalExtensions.ts`**

```ts
/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { RuntimeConfigModulePrivate, RuntimeConfigModulePublic } from './module';

declare module 'vue' {
  interface GlobalComponents {}
  interface ComponentCustomProperties {}
}

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    ['@laioutr/app-essentials-mailer']: RuntimeConfigModulePublic;
  }
  interface RuntimeConfig {
    ['@laioutr/app-essentials-mailer']: RuntimeConfigModulePrivate;
  }
}

export {};
```

- [ ] **Step 5: Delete starter placeholders**

```bash
git rm -r test/basic.test.ts test/fixtures src/runtime/app
```

- [ ] **Step 6: Build to verify the module compiles**

Run: `pnpm prepack`
Expected: `nuxt-module-build` emits `dist/module.mjs`, `dist/types.d.mts`, `dist/runtime/**` without error. (`pnpm vitest run` has no tests yet and will report "no test files" — expected.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: app identity, private-only config, module wiring (no validation)"
```

---

### Task 2: Self-contained dev harness (playground)

Make `pnpm dev:prepare` succeed without a fetched `laioutrrc.json` (mirrors the nimstrata playground), which also generates the root `.nuxt/` types and **unlocks `pnpm exec nuxi typecheck`** — the authoritative type gate for later tasks (bare `vue-tsc` doesn't reliably see server-only `#imports` like `defineOrchestr`).

**Files:** Modify `playground/nuxt.config.ts`, `playground/app.vue`.

- [ ] **Step 1: Rewrite `playground/nuxt.config.ts`**

```ts
import srcModule from '../src/module';

export default defineNuxtConfig({
  modules: [
    srcModule,
    '@laioutr-core/frontend-core',
    '@laioutr-core/orchestr',
    '@laioutr-core/devtools',
  ],
  devtools: { enabled: true },
  compatibilityDate: '2025-09-11',
  // Dummy config so the module loads during dev/prepare. Does not send real mail.
  '@laioutr/app-essentials-mailer': {
    transport: { type: 'smtp', host: 'localhost', port: 1025, auth: { user: 'dev', pass: 'dev' } },
    from: 'Dev Shop <noreply@localhost>',
    recipient: 'trader@localhost',
  },
});
```

- [ ] **Step 2: Simplify `playground/app.vue`**

```vue
<template>
  <div>
    <h1>Essentials Mailer — playground</h1>
    <NuxtPage />
  </div>
</template>
```

- [ ] **Step 3: Verify prepare + type gate**

Run: `pnpm dev:prepare`  → completes.
Run: `pnpm exec nuxi typecheck`  → PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: self-contained dev playground"
```

---

### Task 3: Maizzle precompile pipeline (spike + lock the config)

> **Superseded by Decision 6 (as implemented):** template is `emails/form-email.vue` (Maizzle 6 = Vue SFC), tokens are preserved with `v-pre`, and the fields slot is a Handlebars `{{#each fields}}` loop — **not** a raw `{{{fields}}}` slot. The `.html`/`build()` details below are historical.

Stand up the build-time email compilation. **This task contains a spike**: the exact Maizzle config to *preserve* our runtime placeholders through compilation (the documented "compile to a backend templating format" technique — Maizzle compiles to Blade for exactly this) must be confirmed empirically, because everything downstream reads the compiled shell. Acceptance is defined by output, not by an assumed config.

**Files:**
- Modify: `package.json` (add `@maizzle/framework` devDep; add `build:emails` script; prepend it to `dev:prepare` and `prepack`), `.gitignore`
- Create: `maizzle.config.mjs`, `emails/form-email.html`, `scripts/build-emails.mjs`
- Create: `test/compiled-shell.test.ts`

**Interfaces — Produces:**
- Generated `src/runtime/emails/compiled/form-email.ts` exporting `export const formEmailShell: string` — the compiled, CSS-inlined HTML with these tokens intact: `{{heading}}`, `{{intro}}`, `{{formType}}`, `{{formTypeLabel}}`, `{{submittedAt}}`, `{{submittedAtLabel}}`, and the raw slot `{{{fields}}}`.

- [ ] **Step 1: Add the dependency and scripts**

Add to `devDependencies`: `"@maizzle/framework": "latest"` (pin the resolved version after install). Add script `"build:emails": "node scripts/build-emails.mjs"`, and prepend it: `"dev:prepare": "pnpm build:emails && nuxt-module-build build --stub && nuxt-module-build prepare && nuxi prepare playground"`, `"prepack": "pnpm build:emails && nuxt-module-build build"`. Add to `.gitignore`: `src/runtime/emails/compiled/`.

Run: `pnpm install`  → resolves `@maizzle/framework`. Pin its resolved version in `package.json`.

- [ ] **Step 2: Author the Maizzle template**

Create `emails/form-email.html` — a Maizzle template that produces a simple, email-safe layout: a bold `{{heading}}`, an `{{intro}}` paragraph, a `{{formTypeLabel}}: {{formType}}` line, the raw `{{{fields}}}` slot (a `<table>` of rows injected at runtime), and a `{{submittedAtLabel}}: {{submittedAt}} (UTC)` line. **All placeholders must be escaped from Maizzle's own expression evaluation so they survive into the output** (in posthtml-expressions, escape with `@{{ … }}` → emits literal `{{ … }}`; confirm the exact syntax in Step 5). Use Tailwind classes for styling — Maizzle inlines them.

- [ ] **Step 3: Author the Maizzle config**

Create `maizzle.config.mjs` exporting a config with a `content` glob covering `emails/**/*.html`, CSS inlining enabled, and expression-preservation configured for our `{{ }}`/`{{{ }}}` tokens. Keep it minimal and **brand-lockable** (future apps add templates/components, not pipeline overrides).

- [ ] **Step 4: Write the build script**

Create `scripts/build-emails.mjs` — an ESM Node script that: imports `build` (or `render`) from `@maizzle/framework`, compiles each `emails/*.html` against `maizzle.config.mjs`, and writes each result to `src/runtime/emails/compiled/<name>.ts` as `export const <camelName>Shell = ${JSON.stringify(html)};`. Create the output dir if missing. The `content` glob is a **list** (v1: just `emails/**`) — the seam future apps' dirs extend.

- [ ] **Step 5: SPIKE — run the build and verify placeholder preservation**

Run: `pnpm build:emails`
Then inspect `src/runtime/emails/compiled/form-email.ts`. **Acceptance criteria:**
- The exported string contains **all** tokens literally: `{{heading}}`, `{{intro}}`, `{{formType}}`, `{{formTypeLabel}}`, `{{submittedAt}}`, `{{submittedAtLabel}}`, `{{{fields}}}`.
- CSS is inlined (styles appear as `style="…"` attributes, not only a `<style>` block) and the output is valid HTML.

If tokens were **evaluated/stripped** instead of preserved, adjust the escaping in `emails/form-email.html` and the expression config in `maizzle.config.mjs` and re-run until acceptance passes. **Fallback (if Maizzle cannot cleanly preserve placeholders after reasonable effort):** author `emails/form-email.html` as plain email-safe HTML (Cerberus-derived table) with the same tokens and have `build:emails` inline its CSS with `juice` — this keeps the identical downstream contract (a shell string with the tokens) while dropping Maizzle. Record which path was taken.

- [ ] **Step 6: Write the shell smoke test**

Create `test/compiled-shell.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formEmailShell } from '../src/runtime/emails/compiled/form-email';

describe('compiled form-email shell', () => {
  it('preserves every runtime placeholder', () => {
    for (const token of ['{{heading}}', '{{intro}}', '{{formType}}', '{{formTypeLabel}}', '{{submittedAt}}', '{{submittedAtLabel}}', '{{{fields}}}']) {
      expect(formEmailShell).toContain(token);
    }
  });

  it('has inlined styles', () => {
    expect(formEmailShell).toMatch(/style="/);
  });
});
```

Run: `pnpm vitest run test/compiled-shell.test.ts`  → PASS. (Requires Step 5 to have generated the file.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Maizzle precompile pipeline producing a placeholder-preserving email shell"
```

---

### Task 4: Template renderer (pure shell interpolation)

> **Superseded by Decision 6 (as implemented):** the renderer compiles the shell with **Handlebars** (`Handlebars.compile(shell)(data)`, cached per shell) instead of `String.replaceAll`, and relies on Handlebars' default `{{ }}` escaping instead of a manual `escapeHtml`. There is no `{{{fields}}}` slot — fields render via the template's `{{#each}}` loop. The `.replaceAll`/`escapeHtml`/`renderFieldsTable` code below is historical; the public signature (`renderFormEmail(opts) → { html, text }`, `FormEmailField`, `RenderedEmail`) is unchanged.

The runtime renderer: substitutes per-request data into a compiled shell and derives plaintext. Pure and framework-free (no Maizzle at runtime); the shell is passed in, so tests use a fixture — no dependency on Task 3's generated file.

**Files:**
- Modify: `package.json` (add `html-to-text` dep + `@types/html-to-text` devDep)
- Create: `src/runtime/server/mail/template/renderFormEmail.ts`, `src/runtime/server/mail/template/shells.ts`
- Create: `test/render-form-email.test.ts`

**Interfaces — Produces:**
- `interface FormEmailField { label: string; value: string }`
- `interface RenderFormEmailOptions { shell: string; heading: string; intro: string; formType: string; fields: FormEmailField[]; submittedAt: Date; locale: string }`
- `interface RenderedEmail { html: string; text: string }`
- `renderFormEmail(opts: RenderFormEmailOptions): RenderedEmail`
- `getShell(key: 'form-email'): string` (key-addressed lookup seam)

- [ ] **Step 1: Add dependencies**

Add `"html-to-text": "^9.0.5"` (dependencies) and `"@types/html-to-text": "^9.0.4"` (devDependencies). `pnpm install`.

- [ ] **Step 2: Write the failing renderer test**

Create `test/render-form-email.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderFormEmail } from '../src/runtime/server/mail/template/renderFormEmail';

// Fixture shell mimicking the compiled Maizzle output (tokens intact).
const shell = [
  '<h1>{{heading}}</h1>',
  '<p>{{intro}}</p>',
  '<p><strong>{{formTypeLabel}}:</strong> {{formType}}</p>',
  '<table>{{{fields}}}</table>',
  '<p><strong>{{submittedAtLabel}}:</strong> {{submittedAt}} (UTC)</p>',
].join('');

const base = {
  shell,
  heading: 'New withdrawal',
  intro: 'A new withdrawal has been submitted.',
  formType: 'Withdrawal',
  fields: [
    { label: 'Name', value: 'Alice Example' },
    { label: 'Order reference', value: 'ORD-42' },
    { label: 'Email address', value: 'alice@example.com' },
  ],
  submittedAt: new Date('2026-07-06T10:30:00Z'),
  locale: 'en-US',
};

describe('renderFormEmail', () => {
  it('substitutes scalars and injects field rows into the raw slot', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('New withdrawal');
    expect(html).toContain('A new withdrawal has been submitted.');
    expect(html).toContain('Withdrawal');
    for (const f of base.fields) {
      expect(html).toContain(f.label);
      expect(html).toContain(f.value);
    }
    expect(html).not.toContain('{{'); // every placeholder resolved
  });

  it('formats submittedAt in UTC and uses English chrome labels for en', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('2026');
    expect(html).toContain('Form type');
    expect(html).toContain('Received at');
  });

  it('uses German chrome labels for a de locale', () => {
    const { html } = renderFormEmail({ ...base, locale: 'de-DE' });
    expect(html).toContain('Formulartyp');
    expect(html).toContain('Eingegangen am');
  });

  it('HTML-escapes user-supplied values', () => {
    const { html } = renderFormEmail({ ...base, fields: [{ label: 'Name', value: 'Müller & <script>x</script>' }] });
    expect(html).toContain('Müller &amp; &lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('derives plaintext with no HTML tags', () => {
    const { text } = renderFormEmail(base);
    expect(text).toContain('Alice Example');
    expect(text).not.toMatch(/<[a-z]/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run test/render-form-email.test.ts`  → FAIL (module not found).

- [ ] **Step 4: Implement the renderer**

Create `src/runtime/server/mail/template/renderFormEmail.ts`:

```ts
import { convert } from 'html-to-text';

export interface FormEmailField {
  label: string;
  value: string;
}

export interface RenderFormEmailOptions {
  /** Compiled shell with {{scalar}} tokens and a {{{fields}}} raw slot. */
  shell: string;
  heading: string;
  intro: string;
  formType: string;
  fields: FormEmailField[];
  submittedAt: Date;
  /** BCP-47 locale; used for chrome labels + UTC date formatting. */
  locale: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const CHROME = {
  de: { formType: 'Formulartyp', submittedAt: 'Eingegangen am' },
  en: { formType: 'Form type', submittedAt: 'Received at' },
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Pure: fills a precompiled shell with per-request data. No email framework at runtime. */
export function renderFormEmail(opts: RenderFormEmailOptions): RenderedEmail {
  const lang = opts.locale.split('-')[0].toLowerCase();
  const chrome = CHROME[lang as keyof typeof CHROME] ?? CHROME.en;
  const submittedAt = new Intl.DateTimeFormat(opts.locale, {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(opts.submittedAt);

  const fieldsHtml = opts.fields
    .map(
      (f) =>
        `<tr><td style="padding:4px 8px;font-weight:bold;">${escapeHtml(f.label)}</td>` +
        `<td style="padding:4px 8px;">${escapeHtml(f.value)}</td></tr>`,
    )
    .join('');

  const html = opts.shell
    .replaceAll('{{heading}}', escapeHtml(opts.heading))
    .replaceAll('{{intro}}', escapeHtml(opts.intro))
    .replaceAll('{{formType}}', escapeHtml(opts.formType))
    .replaceAll('{{formTypeLabel}}', escapeHtml(chrome.formType))
    .replaceAll('{{submittedAt}}', escapeHtml(submittedAt))
    .replaceAll('{{submittedAtLabel}}', escapeHtml(chrome.submittedAt))
    .replace('{{{fields}}}', fieldsHtml);

  const text = convert(html, { wordwrap: false });
  return { html, text };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run test/render-form-email.test.ts`  → PASS.

- [ ] **Step 6: Add the key-addressed shell lookup**

Create `src/runtime/server/mail/template/shells.ts`:

```ts
import { formEmailShell } from '../../../emails/compiled/form-email';

/** Key → compiled shell. v1 has one; the map is the seam future apps' templates extend. */
const SHELLS = { 'form-email': formEmailShell } as const;

export type ShellKey = keyof typeof SHELLS;

export function getShell(key: ShellKey): string {
  return SHELLS[key];
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: pure shell-interpolation renderer + key-addressed shell lookup"
```

---

### Task 5: Mail transport seam (interface + SMTP adapter + resolver)

The reusable transport boundary, mirroring the proven cockpit nodemailer shape.

**Files:**
- Modify: `package.json` (add `nodemailer` dep + `@types/nodemailer` devDep)
- Create: `src/runtime/server/mail/transport/{types,smtp,resolveTransport}.ts`
- Create: `test/transport.test.ts`

**Interfaces — Produces:**
- `interface MailMessage { from: string; to: string; replyTo?: string; subject: string; html: string; text: string }`
- `interface SendResult { messageId?: string }`
- `interface MailTransport { send(message: MailMessage): Promise<SendResult> }`
- `createSmtpTransport(config: SmtpTransportConfig): MailTransport`
- `resolveTransport(config: MailerConfig): MailTransport`

- [ ] **Step 1: Add dependencies**

Add `"nodemailer": "^6.9.16"` (dependencies), `"@types/nodemailer": "^6.4.16"` (devDependencies). `pnpm install`.

- [ ] **Step 2: Create transport types**

Create `src/runtime/server/mail/transport/types.ts`:

```ts
export type { MailerConfig, SmtpTransportConfig } from '../../../../config-types';

export interface MailMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  messageId?: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<SendResult>;
}
```

- [ ] **Step 3: Write the failing transport test**

Create `test/transport.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
vi.mock('nodemailer', () => ({
  createTransport: createTransportMock,
  default: { createTransport: createTransportMock },
}));

import { createSmtpTransport } from '../src/runtime/server/mail/transport/smtp';
import { resolveTransport } from '../src/runtime/server/mail/transport/resolveTransport';

const smtp = { type: 'smtp' as const, host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'u', pass: 'p' } };
const message = { from: 'a@b.com', to: 'c@d.com', replyTo: 'e@f.com', subject: 'S', html: '<p>h</p>', text: 'h' };

beforeEach(() => { sendMailMock.mockReset(); createTransportMock.mockClear(); });

describe('createSmtpTransport', () => {
  it('creates a nodemailer transport from the smtp config', () => {
    createSmtpTransport(smtp);
    expect(createTransportMock).toHaveBeenCalledWith({ host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'u', pass: 'p' } });
  });
  it('maps MailMessage onto sendMail and returns the messageId', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc' });
    const r = await createSmtpTransport(smtp).send(message);
    expect(sendMailMock).toHaveBeenCalledWith({ from: 'a@b.com', to: 'c@d.com', replyTo: 'e@f.com', subject: 'S', text: 'h', html: '<p>h</p>' });
    expect(r).toEqual({ messageId: 'abc' });
  });
});

describe('resolveTransport', () => {
  it('returns an smtp transport for type "smtp"', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'x' });
    await resolveTransport({ transport: smtp, from: 'a@b.com', recipient: 'c@d.com' }).send(message);
    expect(createTransportMock).toHaveBeenCalledTimes(1);
  });
  it('throws for an unsupported transport type', () => {
    const bad = { transport: { type: 'pigeon' }, from: 'a', recipient: 'b' } as never;
    expect(() => resolveTransport(bad)).toThrow(/Unsupported mail transport type/);
  });
});
```

- [ ] **Step 4: Run to verify it fails** — `pnpm vitest run test/transport.test.ts` → FAIL.

- [ ] **Step 5: Implement the adapter + resolver**

`src/runtime/server/mail/transport/smtp.ts`:

```ts
import { createTransport } from 'nodemailer';
import type { MailMessage, MailTransport, SendResult, SmtpTransportConfig } from './types';

export function createSmtpTransport(config: SmtpTransportConfig): MailTransport {
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
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

`src/runtime/server/mail/transport/resolveTransport.ts`:

```ts
import { createSmtpTransport } from './smtp';
import type { MailTransport, MailerConfig } from './types';

export function resolveTransport(config: MailerConfig): MailTransport {
  switch (config.transport.type) {
    case 'smtp':
      return createSmtpTransport(config.transport);
    default:
      throw new Error(`Unsupported mail transport type: ${(config.transport as { type: string }).type}`);
  }
}
```

- [ ] **Step 6: Run to verify it passes** — `pnpm vitest run test/transport.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: mail transport seam with nodemailer SMTP adapter and resolver"
```

---

### Task 6: Withdrawal orchestration (localized strings + p-retry two-send flow)

The withdrawal logic as a **pure, dependency-injected** function. Sends the **store notice first** (critical; retried via `p-retry` on transient pre-delivery errors only), then the **consumer acknowledgement** (best-effort — its failure must not fail the withdrawal). The renderer and transport are injected so this is testable without Maizzle/Nuxt.

**Files:**
- Modify: `package.json` (add `p-retry`)
- Create: `src/runtime/server/mail/withdrawal/strings.ts`, `src/runtime/server/mail/withdrawal/handleWithdrawal.ts`
- Create: `test/withdrawal-strings.test.ts`, `test/handle-withdrawal.test.ts`

**Interfaces — Produces:**
- `interface WithdrawalStrings { formType; subjectStoreNotice; subjectConsumerAck; storeNotice: { heading; intro }; consumerAck: { heading; intro }; fieldLabels: { name; orderReference; email }; errors: { deliveryFailed } }` (all `string`)
- `getWithdrawalStrings(locale: string): WithdrawalStrings`
- `interface WithdrawalInput { name: string; orderReference: string; email: string }`
- `type RenderEmail = (opts: { heading: string; intro: string; formType: string; fields: FormEmailField[]; submittedAt: Date; locale: string }) => RenderedEmail`
- `interface HandleWithdrawalDeps { input: WithdrawalInput; locale: string; config: MailerConfig; transport: MailTransport; renderEmail: RenderEmail; now: () => Date; logger?: Pick<Console, 'error'>; retries?: number; minTimeout?: number }`
- `handleWithdrawal(deps: HandleWithdrawalDeps): Promise<{ success: boolean; message?: string }>`

- [ ] **Step 1: Add dependency** — add `"p-retry": "^6.2.1"` (dependencies). `pnpm install`.

- [ ] **Step 2: Write the failing strings test**

Create `test/withdrawal-strings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getWithdrawalStrings } from '../src/runtime/server/mail/withdrawal/strings';

describe('getWithdrawalStrings', () => {
  it('German for de', () => { const s = getWithdrawalStrings('de-DE'); expect(s.formType).toBe('Widerruf'); expect(s.fieldLabels.orderReference).toBe('Bestellnummer'); });
  it('English for en', () => { const s = getWithdrawalStrings('en-US'); expect(s.formType).toBe('Withdrawal'); expect(s.fieldLabels.orderReference).toBe('Order reference'); });
  it('English fallback', () => { expect(getWithdrawalStrings('fr-FR').formType).toBe('Withdrawal'); });
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm vitest run test/withdrawal-strings.test.ts` → FAIL.

- [ ] **Step 4: Implement the strings**

Create `src/runtime/server/mail/withdrawal/strings.ts`:

```ts
export interface WithdrawalStrings {
  formType: string;
  subjectStoreNotice: string;
  subjectConsumerAck: string;
  storeNotice: { heading: string; intro: string };
  consumerAck: { heading: string; intro: string };
  fieldLabels: { name: string; orderReference: string; email: string };
  errors: { deliveryFailed: string };
}

const STRINGS: Record<'de' | 'en', WithdrawalStrings> = {
  de: {
    formType: 'Widerruf',
    subjectStoreNotice: 'Neuer Widerruf eingegangen',
    subjectConsumerAck: 'Eingangsbestätigung Ihres Widerrufs',
    storeNotice: { heading: 'Neuer Widerruf', intro: 'Über das Widerrufsformular ist ein neuer Widerruf eingegangen. Die Angaben des Verbrauchers finden Sie unten.' },
    consumerAck: { heading: 'Eingangsbestätigung Ihres Widerrufs', intro: 'Wir bestätigen den Eingang Ihres Widerrufs mit den unten aufgeführten Angaben. Diese Bestätigung dient als Nachweis auf einem dauerhaften Datenträger.' },
    fieldLabels: { name: 'Name', orderReference: 'Bestellnummer', email: 'E-Mail-Adresse' },
    errors: { deliveryFailed: 'Ihr Widerruf konnte derzeit nicht übermittelt werden. Bitte versuchen Sie es später erneut.' },
  },
  en: {
    formType: 'Withdrawal',
    subjectStoreNotice: 'New withdrawal received',
    subjectConsumerAck: 'Confirmation of your withdrawal',
    storeNotice: { heading: 'New withdrawal', intro: 'A new withdrawal has been submitted through the withdrawal form. The consumer’s details are listed below.' },
    consumerAck: { heading: 'Confirmation of your withdrawal', intro: 'We confirm receipt of your withdrawal with the details listed below. This confirmation serves as evidence on a durable medium.' },
    fieldLabels: { name: 'Name', orderReference: 'Order reference', email: 'Email address' },
    errors: { deliveryFailed: 'Your withdrawal could not be submitted at this time. Please try again later.' },
  },
};

export function getWithdrawalStrings(locale: string): WithdrawalStrings {
  const lang = locale.split('-')[0].toLowerCase();
  return STRINGS[lang as 'de' | 'en'] ?? STRINGS.en;
}
```

- [ ] **Step 5: Run to verify it passes** — `pnpm vitest run test/withdrawal-strings.test.ts` → PASS.

- [ ] **Step 6: Write the failing orchestration test**

Create `test/handle-withdrawal.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleWithdrawal } from '../src/runtime/server/mail/withdrawal/handleWithdrawal';
import type { MailMessage, MailTransport, SendResult } from '../src/runtime/server/mail/transport/types';

const input = { name: 'Alice', orderReference: 'ORD-42', email: 'alice@example.com' };
const cfg = (o = {}) => ({ transport: { type: 'smtp' as const, host: 'h', port: 587, auth: { user: 'u', pass: 'p' } }, from: 'Shop <noreply@example.com>', recipient: 'trader@example.com', replyToConsumer: true, ...o });
// Fake renderer — no shell/Maizzle needed.
const renderEmail = (o: { heading: string }) => ({ html: `<h1>${o.heading}</h1>`, text: o.heading });
const now = () => new Date('2026-07-06T10:30:00Z');

function recorder(fail?: (m: MailMessage) => Error | undefined) {
  const sent: MailMessage[] = [];
  const transport: MailTransport = { async send(m): Promise<SendResult> { sent.push(m); const e = fail?.(m); if (e) throw e; return { messageId: `id-${sent.length}` }; } };
  return { transport, sent };
}
const err = (code: string) => Object.assign(new Error(code), { code });

describe('handleWithdrawal', () => {
  it('sends store notice first (reply-to consumer), then consumer ack, returns success', async () => {
    const { transport, sent } = recorder();
    const r = await handleWithdrawal({ input, locale: 'de-DE', config: cfg(), transport, renderEmail, now });
    expect(r).toEqual({ success: true });
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBe('trader@example.com');
    expect(sent[0].replyTo).toBe('alice@example.com');
    expect(sent[1].to).toBe('alice@example.com');
    expect(sent[1].replyTo).toBeUndefined();
  });

  it('omits store-notice reply-to when replyToConsumer is false', async () => {
    const { transport, sent } = recorder();
    await handleWithdrawal({ input, locale: 'en-US', config: cfg({ replyToConsumer: false }), transport, renderEmail, now });
    expect(sent[0].replyTo).toBeUndefined();
  });

  it('retries the store notice once on a transient ECONNECTION and then succeeds', async () => {
    let n = 0;
    const transport: MailTransport = { async send(m) { if (m.to === 'trader@example.com') { n++; if (n === 1) throw err('ECONNECTION'); } return { messageId: 'ok' }; } };
    const r = await handleWithdrawal({ input, locale: 'en-US', config: cfg(), transport, renderEmail, now, minTimeout: 0 });
    expect(r).toEqual({ success: true });
    expect(n).toBe(2);
  });

  it('does NOT retry on a non-transient error (EENVELOPE) and returns success:false without sending the consumer ack', async () => {
    const logger = { error: vi.fn() };
    const { transport, sent } = recorder((m) => (m.to === 'trader@example.com' ? err('EENVELOPE') : undefined));
    const r = await handleWithdrawal({ input, locale: 'en-US', config: cfg(), transport, renderEmail, now, minTimeout: 0, logger });
    expect(r.success).toBe(false);
    expect(r.message).toContain('could not be submitted');
    expect(sent.filter((m) => m.to === 'trader@example.com')).toHaveLength(1); // aborted, no retry
    expect(sent.some((m) => m.to === 'alice@example.com')).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('still returns success when the consumer ack fails (best-effort), logging it', async () => {
    const logger = { error: vi.fn() };
    const { transport } = recorder((m) => (m.to === 'alice@example.com' ? err('ECONNECTION') : undefined));
    const r = await handleWithdrawal({ input, locale: 'en-US', config: cfg(), transport, renderEmail, now, minTimeout: 0, logger });
    expect(r).toEqual({ success: true });
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run to verify it fails** — `pnpm vitest run test/handle-withdrawal.test.ts` → FAIL.

- [ ] **Step 8: Implement the orchestration**

Create `src/runtime/server/mail/withdrawal/handleWithdrawal.ts`:

```ts
import pRetry, { AbortError } from 'p-retry';
import { getWithdrawalStrings } from './strings';
import type { FormEmailField, RenderedEmail } from '../template/renderFormEmail';
import type { MailMessage, MailTransport, MailerConfig } from '../transport/types';

export interface WithdrawalInput {
  name: string;
  orderReference: string;
  email: string;
}

export type RenderEmail = (opts: {
  heading: string;
  intro: string;
  formType: string;
  fields: FormEmailField[];
  submittedAt: Date;
  locale: string;
}) => RenderedEmail;

export interface HandleWithdrawalDeps {
  input: WithdrawalInput;
  locale: string;
  config: MailerConfig;
  transport: MailTransport;
  renderEmail: RenderEmail;
  now: () => Date;
  logger?: Pick<Console, 'error'>;
  /** Store-notice retries (default 1). */
  retries?: number;
  /** Backoff ms (default 500; tests pass 0). */
  minTimeout?: number;
}

export interface WithdrawalResult {
  success: boolean;
  message?: string;
}

/** Transient, unambiguously pre-delivery nodemailer error codes — safe to retry. */
const RETRYABLE_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS']);

async function sendStoreNotice(transport: MailTransport, message: MailMessage, retries: number, minTimeout: number) {
  return pRetry(
    async () => {
      try {
        return await transport.send(message);
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (!code || !RETRYABLE_CODES.has(code)) {
          // Not a transient pre-delivery error — stop; retrying risks a duplicate send.
          throw new AbortError(error instanceof Error ? error : new Error(String(error)));
        }
        throw error; // retryable
      }
    },
    { retries, minTimeout, factor: 1 },
  );
}

export async function handleWithdrawal({
  input,
  locale,
  config,
  transport,
  renderEmail,
  now,
  logger = console,
  retries = 1,
  minTimeout = 500,
}: HandleWithdrawalDeps): Promise<WithdrawalResult> {
  const submittedAt = now();
  const strings = getWithdrawalStrings(locale);
  const fields: FormEmailField[] = [
    { label: strings.fieldLabels.name, value: input.name },
    { label: strings.fieldLabels.orderReference, value: input.orderReference },
    { label: strings.fieldLabels.email, value: input.email },
  ];

  // 1. Store notice — critical.
  const storeBody = renderEmail({ heading: strings.storeNotice.heading, intro: strings.storeNotice.intro, formType: strings.formType, fields, submittedAt, locale });
  const storeMessage: MailMessage = {
    from: config.from,
    to: config.recipient,
    replyTo: config.replyToConsumer === false ? undefined : input.email,
    subject: strings.subjectStoreNotice,
    html: storeBody.html,
    text: storeBody.text,
  };
  try {
    await sendStoreNotice(transport, storeMessage, retries, minTimeout);
  } catch (error) {
    logger.error('[essentials-mailer] withdrawal store notice failed', error);
    return { success: false, message: strings.errors.deliveryFailed };
  }

  // 2. Consumer acknowledgement — best-effort; failure must not fail the withdrawal.
  const ackBody = renderEmail({ heading: strings.consumerAck.heading, intro: strings.consumerAck.intro, formType: strings.formType, fields, submittedAt, locale });
  const ackMessage: MailMessage = {
    from: config.from,
    to: input.email,
    subject: strings.subjectConsumerAck,
    html: ackBody.html,
    text: ackBody.text,
  };
  try {
    await transport.send(ackMessage);
  } catch (error) {
    logger.error('[essentials-mailer] withdrawal consumer acknowledgement failed', error);
  }

  return { success: true };
}
```

- [ ] **Step 9: Run all logic tests** — `pnpm vitest run` → PASS (compiled-shell, render-form-email, transport, withdrawal-strings, handle-withdrawal).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: withdrawal orchestration with p-retry (pre-delivery errors only)"
```

---

### Task 7: Orchestr action handler registration (GATED on token publish)

Bind `WithdrawalAction` to the app and wire config → transport → renderer → `handleWithdrawal`. **Blocked until a token-bearing `canonical-types` is installable** (Decision 4).

**Files:**
- Modify: `package.json` (bump `@laioutr-core/canonical-types` peer floor)
- Create: `src/runtime/server/middleware/index.ts`, `src/runtime/server/orchestr/legal/withdrawal.action.ts`

**Interfaces — Produces:** `defineEssentialsMailerAction`; `export default defineEssentialsMailerAction(WithdrawalAction, handler)` (auto-registered via `orchestrDirs`).

- [ ] **Step 1: Install the token-bearing canonical-types and bump the floor**

Run: `npm view @laioutr-core/canonical-types version --registry https://npm.laioutr.cloud` → note version `X`.
Run: `pnpm add -D @laioutr-core/canonical-types@X`; set `"@laioutr-core/canonical-types": ">=X"` in `peerDependencies`.
Verify: `node -e "import('@laioutr-core/canonical-types/ecommerce').then(m => console.log('WithdrawalAction' in m ? 'ok' : 'MISSING'))"` → `ok`. (If `MISSING`, the token isn't published yet — stop; this task is blocked.)

- [ ] **Step 2: Create the shortcut**

`src/runtime/server/middleware/index.ts`:

```ts
import { defineOrchestr } from '#imports';
import { name } from '../../../../package.json';

export const defineEssentialsMailer = defineOrchestr.meta({ app: name, label: 'Essentials Mailer' });
export const defineEssentialsMailerAction = defineEssentialsMailer.actionHandler;
```

- [ ] **Step 3: Create the action file**

`src/runtime/server/orchestr/legal/withdrawal.action.ts`:

```ts
import { WithdrawalAction } from '@laioutr-core/canonical-types/ecommerce';
import { useRuntimeConfig } from '#imports';
import { name } from '../../../../../package.json';
import { defineEssentialsMailerAction } from '../../middleware';
import { resolveTransport } from '../../mail/transport/resolveTransport';
import { renderFormEmail } from '../../mail/template/renderFormEmail';
import { getShell } from '../../mail/template/shells';
import { handleWithdrawal } from '../../mail/withdrawal/handleWithdrawal';
import type { MailerConfig } from '../../mail/transport/types';

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
```

- [ ] **Step 4: Full type gate + build**

Run: `pnpm dev:prepare` → completes (handler discovered under `orchestrDirs`).
Run: `pnpm exec nuxi typecheck` → PASS (app context; excludes `src/runtime/server`).
Run the server nitro context: `pnpm exec vue-tsc --noEmit -p src/runtime/server/tsconfig.json` → PASS.
Run: `pnpm prepack` → emits `dist/runtime/server/orchestr/legal/withdrawal.action.js`.

> **Implementation note (as built):** the orchestr auto-import `defineOrchestr` is registered only in the **consumer** nitro context, not the module-root `.nuxt`. So `src/runtime/server/tsconfig.json` was repointed to extend **`../../../playground/.nuxt/tsconfig.server.json`** (was module-root `.nuxt/tsconfig.server.json`). Tasks 1–6/8 didn't use orchestr `#imports`, so they passed under the root context; Task 7 is the first to, which forced the switch. The server type gate therefore requires `pnpm dev:prepare` to have prepared the playground first.

- [ ] **Step 5: Unit suite still green** — `pnpm vitest run` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: register WithdrawalAction handler; bump canonical-types peer floor"
```

---

### Task 8: Server-only public API (`/server`) + `sendMail`

Expose the reusable transport + renderer + `sendMail` behind a server-only subpath — the shared API future essentials apps call. Generic only (no withdrawal specifics, no `#imports`).

**Files:**
- Modify: `package.json` (`exports` adds `./server`)
- Create: `src/runtime/server/mail/sendMail.ts`, `src/runtime/server/mail/index.ts`
- Create: `test/send-mail.test.ts`

**Interfaces — Produces:** `sendMail(config: MailerConfig, message: MailMessage): Promise<SendResult>`; `@laioutr/app-essentials-mailer/server` re-exporting `createSmtpTransport`, `resolveTransport`, `renderFormEmail`, `getShell`, `sendMail` + their types.

- [ ] **Step 1: Write the failing sendMail test**

Create `test/send-mail.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
vi.mock('nodemailer', () => ({ createTransport: createTransportMock, default: { createTransport: createTransportMock } }));
import { sendMail } from '../src/runtime/server/mail/sendMail';

beforeEach(() => { sendMailMock.mockReset(); createTransportMock.mockClear(); });

describe('sendMail', () => {
  it('resolves the transport from config and sends the message', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'sent-1' });
    const r = await sendMail(
      { transport: { type: 'smtp', host: 'h', port: 587, auth: { user: 'u', pass: 'p' } }, from: 'a@b.com', recipient: 'c@d.com' },
      { from: 'a@b.com', to: 'c@d.com', subject: 's', html: '<p>h</p>', text: 'h' },
    );
    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ messageId: 'sent-1' });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run test/send-mail.test.ts` → FAIL.

- [ ] **Step 3: Implement `sendMail` + barrel**

`src/runtime/server/mail/sendMail.ts`:

```ts
import { resolveTransport } from './transport/resolveTransport';
import type { MailMessage, MailerConfig, SendResult } from './transport/types';

export function sendMail(config: MailerConfig, message: MailMessage): Promise<SendResult> {
  return resolveTransport(config).send(message);
}
```

`src/runtime/server/mail/index.ts`:

```ts
export { createSmtpTransport } from './transport/smtp';
export { resolveTransport } from './transport/resolveTransport';
export { renderFormEmail } from './template/renderFormEmail';
export { getShell } from './template/shells';
export { sendMail } from './sendMail';

export type { MailTransport, MailMessage, SendResult, MailerConfig, SmtpTransportConfig } from './transport/types';
export type { FormEmailField, RenderFormEmailOptions, RenderedEmail } from './template/renderFormEmail';
export type { ShellKey } from './template/shells';
```

- [ ] **Step 4: Add the `./server` export**

In `package.json` set:

```jsonc
"exports": {
  ".": { "types": "./dist/types.d.mts", "import": "./dist/module.mjs" },
  "./server": { "types": "./dist/runtime/server/mail/index.d.ts", "import": "./dist/runtime/server/mail/index.js" }
}
```

- [ ] **Step 5: Run to verify it passes** — `pnpm vitest run test/send-mail.test.ts` → PASS.

- [ ] **Step 6: Build and verify the `/server` entry emits**

Run: `pnpm prepack`; then `ls dist/runtime/server/mail/index.js dist/runtime/server/mail/index.d.ts` → both exist. (If module-builder emits a different runtime extension, update the `./server` `import` path to match and rebuild.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: server-only /server API (transport + renderer + sendMail)"
```

---

### Task 9: Documentation, extensibility notes, and final verification

**Files:** Modify `README.md`.

- [ ] **Step 1: Rewrite `README.md`** — cover: what it is (essentials mail backbone; v1 = withdrawal); config example (`transport`/`from`/`recipient`/`replyToConsumer`) with an explicit **"SMTP credentials are private-only, never client-exposed"** note; the `@laioutr/app-essentials-mailer/server` API; and how emails are authored (Maizzle template → compiled shell at build → runtime interpolation). Include the **Extensibility (future)** section verbatim below.

````markdown
## Extensibility (future)

The mailer is built to become the shared email backbone for the essentials-apps
family. Multi-app template contribution is **not implemented in v1**, but the seams exist:

- **Exportable Maizzle config** (`maizzle.config.mjs`) — the single styling/pipeline source.
- **Key-addressed renderer** (`getShell(key)` + `renderFormEmail`) — templates are looked up by key.
- **Configurable compile globs** (`scripts/build-emails.mjs` `content` list) — v1 lists only this app's `emails/`.
- **Shared server API** (`@laioutr/app-essentials-mailer/server`) — `sendMail`, `resolveTransport`, `renderFormEmail`.

When a second essentials app needs to send email, add a **registration hook** so apps
contribute a raw-template directory (+ optional components) that is compiled **at the
consumer build** against the shared config into Nitro server assets, then rendered/sent
through the shared API. At that point `@maizzle/framework` moves from a devDependency to a
build-time dependency (present at the consumer build, still tree-shaken from the runtime
bundle). This mirrors how Laioutr apps already contribute `orchestrDirs`/`sections`/`blocks`.
````

- [ ] **Step 2: Full local gate**

```bash
pnpm lint
pnpm build:emails
pnpm dev:prepare
pnpm exec nuxi typecheck   # requires Task 7's token; if still blocked, run after publish
pnpm vitest run
pnpm prepack
```

Expected: `lint` clean; `build:emails` regenerates the shell; `dev:prepare` completes; `nuxi typecheck` clean; `vitest run` all green (compiled-shell, render-form-email, transport, withdrawal-strings, handle-withdrawal, send-mail); `prepack` builds `dist/` with the `./server` entry.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: README + extensibility notes"
```

---

## Self-Review (author's spec-coverage check)

Design §7 → tasks, with the review decisions applied:
- §7.1 scaffolding/identity → **Task 1**.
- §7.2 registration + **private-only** storage → **Task 1** (validation dropped per Decision 1).
- §7.3 transport seam (nodemailer SMTP) → **Task 5**.
- §7.4 templating → **Tasks 3–4** (Maizzle-precompiled per Decision 2, not runtime MJML).
- §7.5 action handler (fields, `submittedAt`, `clientEnv.locale`; store notice first with retry, then best-effort ack) → **Task 6** (logic, p-retry per Decision 3) + **Task 7** (wiring, gated per Decision 4).
- §7.6 server-only export → **Task 8**.
- §10 sequencing (peer-depend on published token) → **Task 7**.

Type-consistency spot check: `MailerConfig`/`SmtpTransportConfig` (Task 1) flow through transport (5), orchestration (6), action (7), and `/server` (8); `renderFormEmail`/`FormEmailField`/`RenderedEmail` (Task 4) are consumed by the injected `RenderEmail` in Task 6 and re-exported in Task 8; `getShell('form-email')` (Task 4) is used only in Task 7's wiring.

**Known limitation (v1):** email field labels come from `getWithdrawalStrings` (locale dictionary), not the block's editor-configured identifier label — that label is not carried in the token input. Deferred by design: `ActionOutcome` envelope (§9), abuse-protection initware (§8), `MailProvider` registry (§7.6), first-party API transports (§9), and multi-app template registration (this plan's Extensibility section).
