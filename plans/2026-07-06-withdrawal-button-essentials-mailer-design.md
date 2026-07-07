# Withdrawal Button + Essentials Mailer — Design

**Date:** 2026-07-06
**Status:** Design approved, ready for implementation plan
**Author:** Sebastian Langer (with Claude)

## 1. Summary

EU consumer-protection law now requires online shops to provide a one-click
**withdrawal function** (*Widerrufsbutton*). This design delivers that as a
reusable Laioutr feature spanning two repos:

1. A configurable **UI block** (`BlockWithdrawalButton`) that renders a button
   which opens a modal form (name, order/contract identifier, email).
2. A canonical **orchestr action token** (`ecommerce/legal/withdrawal`) carrying
   the submitted data.
3. A new standalone open-source app **`@laioutr/app-essentials-mailer`** whose
   action-handler formats the submission into email and sends it via a
   configurable transport — both a **notice to the store** and the
   legally-required **acknowledgement to the consumer**.

This is the first feature of a planned family of "essentials" apps (SEO,
schema.org, …); only the mailer + withdrawal feature is in scope here.

## 2. Legal basis (why the shape is what it is)

The controlling law is **§ 356a BGB / Art. 11a of Directive 2011/83/EU** — the
mandatory online withdrawal button, in force since **19 June 2026**. Key
constraints that drive the design:

- **Exactly three fields may be *mandatory*:** consumer **name**, a
  **contract/order identifier**, and an **electronic contact** (email)
  (§ 356a(2)). Our form requires exactly these three. `orderReference` is the
  permitted contract-identification field, so requiring it is fine — but we
  require **only one** identifier and keep its label configurable so the
  consumer can supply an identifier they actually have.
- **A mandatory "reason" field is not allowed** (Abmahnung risk). We ship no
  reason field in v1.
- **No signature, no login/account gating** — anonymous submission via
  identifier + email must work.
- **An automatic acknowledgement to the consumer is mandatory** — an
  *Eingangsbestätigung* on a durable medium containing the declaration content +
  a timestamp (§ 356a(4)). Hence the handler sends **two** emails.
- **Timeliness is measured by dispatch**, so we capture and include a
  server-side timestamp.

> Legal note for sign-off (not a build blocker): § 356a envisions a
> "fill form → confirm" flow. The Figma's single form + "Widerruf jetzt
> abschließen" button reads as that confirmation step; worth a lawyer's nod, but
> we believe the design is compliant as-is.

## 3. Architecture overview

The feature spans the **monorepo** (published core packages) and a **separate
open-source repo** (the app).

| Surface | Repo / package | Notes |
|---|---|---|
| Action token `ecommerce/legal/withdrawal` | monorepo · `@laioutr-core/canonical-types` | Shared contract; both block and app import it |
| UI: `WithdrawalButton` + `WithdrawalForm` | monorepo · `@laioutr-app/ui` (`packages/ui`) | The visual/interactive components |
| UI block: `BlockWithdrawalButton` | monorepo · `@laioutr-app/ui` studio block layer (`packages/ui-app`) | Studio-configurable block wrapping the ui component |
| Client-side form validation | monorepo · local to `WithdrawalForm` (v1) | Reuses the token's zod input schema; see §6 |
| The app | **separate repo** · `@laioutr/app-essentials-mailer` | Based on `laioutr/app-starter`; transport + template + handler |

Rationale for the split: the token is a canonical concept and the block is
published core — both belong in the monorepo. The app is the external,
open-source, per-project-installable piece under the **public `@laioutr/*`**
namespace (requires CTO approval to publish).

## 4. The action token (`canonical-types`)

`ecommerce/legal/withdrawal`, defined with `defineActionToken` in
`packages/canonical-types/src/lib/ecommerce/legal/withdrawal.action.ts`,
re-exported via the existing `ecommerce` subpath
(`@laioutr-core/canonical-types/ecommerce`) — no new subpath export needed.

```ts
input: z.object({
  name: z.string().min(1),
  orderReference: z.string().min(1),   // configurable label ("Bestellnummer", "Versichertennummer", …)
  email: z.email(),
})
output: FeedbackResponse   // { success: boolean; message?: string } — existing canonical type
```

- **Locale** is read by the handler from `clientEnv` (already available), not
  from `input`.
- **Timestamp** and the **recipient address** are server/config concerns, never
  client input.
- **Output** reuses the existing `FeedbackResponse` (`packages/canonical-types/
  src/common/FeedbackResponse.ts`). This is deliberately minimal — withdrawal
  has no server-side field validation (all three fields are client-validatable)
  and the only server failure is a transport error surfaced as a general
  message. When the `ActionOutcome` standard lands (§9), withdrawal migrates its
  output onto it.

## 5. UI (`ui` + `ui-app`)

Follows the existing "Write a Review" precedent (button → dialog store → form).

- **`packages/ui/src/runtime/components/Withdrawal/WithdrawalButton.vue`** —
  renders the trigger button. On click:
  `useDialogStore().openDialog({ component: WithdrawalForm, props })`.
- **`packages/ui/src/runtime/components/Withdrawal/WithdrawalForm.vue`** — a
  native `<form @submit.prevent>` with three `Field` + `Input` atoms (name,
  identifier, email). Runs client-side validation (§6), dispatches
  `useMutationAction(WithdrawalAction)`, and on success closes the dialog and
  fires a success toast; on failure shows an error toast/banner.
- **`packages/ui-app/src/runtime/app/block/BlockWithdrawalButton.vue`** — the
  Studio block wrapping `WithdrawalButton`, standalone.

**Editor-configurable, localized props** (schema `text` fields):

- button label, modal heading, intro body
- the **three field labels + placeholders** (this is where "Versichertennummer"
  is set per store)
- submit-button label, success-toast text
- the "more info" hint link (text + URL → the store's *Widerrufsbelehrung*)

Fixed chrome (validation/aria strings) uses `$tl`. No new ui-kit atom is
required (three text/email inputs only).

## 6. Client-side validation

Withdrawal's fields are all structural, so field errors are produced
**client-side** from the token's zod input schema — instant, no round-trip,
which is where "invalid email" belongs:

- On submit (and optionally blur), `WithdrawalForm` runs the token's input
  schema via `safeParse`, and maps each `ZodError.issue` to the matching
  `Field`'s `invalid` + `errorMessage` (the `Field` contract already supports
  this). The block only dispatches when client-valid.
- The mapped message is shaped as `{ severity, text, path }` — the same shape
  the future `ActionOutcome` message will use — so there is **no rework** when
  withdrawal migrates onto the standard. `path` mirrors `issue.path`
  (e.g. `['email']`).
- For v1 this lives **local to `WithdrawalForm`** (a small helper). It is a
  candidate to generalize into a shared `useZodForm` composable once
  `ActionOutcome` and additional forms arrive — deliberately not generalized
  pre-emptively (YAGNI).

Server errors (transport failure) come back as `FeedbackResponse.success =
false` (+ `message`) and are shown as a general error toast/banner, not under a
field.

## 7. The app (`@laioutr/app-essentials-mailer`)

### 7.1 Scaffolding

Scaffold from the public template: `npx giget@latest gh:laioutr/app-starter`
into a new repo, then rename `my-laioutr-app` → `app-essentials-mailer`
(package name = `configKey` in `module.ts`). Build/release tooling stays as the
starter provides: **`unbuild`/`nuxt-module-build`**, released via **`changelogen`
+ `npm publish`** (the starter does **not** use changesets — that's a
monorepo-only tool). Peer deps: `@laioutr-core/canonical-types`,
`@laioutr-core/core-types`, `@laioutr-core/frontend-core`.

### 7.2 Module registration & config

`module.ts` calls `registerLaioutrApp({ name, version, orchestrDirs })` — **no
sections/blocks** (the block lives in `ui-app`, not the app).

**Config schema** (zod-validated in `setup`), stored in **private
`runtimeConfig[name]` ONLY**:

```ts
{
  transport: { type: 'smtp'; host: string; port: number; secure?: boolean;
               auth: { user: string; pass: string } },   // discriminated union — future providers add variants
  from: string;         // sender address
  recipient: string;    // trader address that receives withdrawal notices
  replyToConsumer?: boolean;   // default true — store-notice reply-to = consumer email
}
```

> **Deviation from the starter:** the app-starter's `module.ts` copies options
> into **both** `runtimeConfig[name]` *and* `runtimeConfig.public[name]`. We must
> **not** copy to `public` — SMTP credentials would leak to the client. Secrets
> stay private-only.

Config forward-compatibility (not built now, but the shape allows it):
`transport.type` is discriminated so `'resend'`/`'postmark'`/… are additive; a
future `{ action, recipient }[]` map replaces the single `recipient` when the
mailer handles more than withdrawal.

### 7.3 Transport (`server/mail/`)

A thin, reusable seam so future essentials features reuse it:

- **`MailTransport` interface**: `{ send(message: MailMessage): Promise<SendResult> }`.
- **`createSmtpTransport(config)`**: nodemailer `createTransport` (mirrors the
  proven cockpit shape). Node runtime is guaranteed (Laioutr projects require
  full Node.js; edge is out of scope), so nodemailer/SMTP is fully viable.
- **`resolveTransport(config)`**: returns the adapter for `config.transport.type`
  (only `'smtp'` in v1).
- Rationale for nodemailer over a unified library (e.g. `unemail`): maturity for
  a legally load-bearing path. SMTP is itself the universal provider
  abstraction — every provider (Resend, SES, Postmark, Brevo, …) exposes SMTP
  credentials, so an SMTP adapter already supports them; first-party API
  adapters are an additive convenience behind the same interface later.

### 7.4 Templating (`server/mail/template/`)

**Generic form-email template** (MJML → HTML, `html-to-text` → plaintext), *not*
withdrawal-specific, so future form-actions reuse it verbatim:

```ts
renderFormEmail({ heading, intro, formType, fields, submittedAt, locale })
  -> { html, text }
// fields: Array<{ label: string; value: string }>
```

The rendered body reads like `Form Type: Withdrawal` + a list of
`<field label>: <value>` rows + the timestamp. Both emails render through this
one template, differing only in `heading`/`intro`.

- `@vue-email` is deliberately avoided (stale, self-labeled experimental). MJML
  is mature and framework-agnostic; `html-to-text` derives the plaintext so we
  maintain one template per email, not two.

### 7.5 Action handler (`server/orchestr/legal/withdrawal.action.ts`)

Registers the handler for `WithdrawalAction` via the app's
`defineEssentialsMailerAction` shortcut (`.meta({ app })` for devtools; no
`extendRequest` needed — the transport is built from `runtimeConfig`). Behavior:

1. Build `fields = [{ label, value }]` from `input` (labels from config/locale),
   stamp `submittedAt` server-side, read `locale` from `clientEnv`.
2. **Send the store notice first** (to `recipient`, reply-to = consumer). This is
   the actual delivery of the withdrawal to the trader. On failure after a small
   retry → return `{ success: false, message }` (withdrawal not delivered).
3. **Send the consumer acknowledgement** (*Eingangsbestätigung*) to the
   consumer's email — durable medium, restates the fields + `submittedAt`. On
   failure → **log for follow-up but still return `{ success: true }`**: the
   withdrawal *was* delivered to the trader; the consumer must not be told their
   withdrawal failed because our confirmation email bounced.
4. Return `{ success: true }`.

### 7.6 External send API (module export)

The app **exports its `sendMail` / `MailTransport` API as a server-only module
export** (behind a server subpath, e.g. `@laioutr/app-essentials-mailer/server`,
so it never enters a client bundle). Any consumer that wants programmatic
server-side sending hard-imports it and accepts the coupling; **if the app isn't
installed, the build breaks loudly** — acceptable for now.

We explicitly reject:
- A canonical `SendMailAction` token — an action is an HTTP client→server
  boundary; using it for server→server sending would be a self-HTTP round-trip.
- A `MailProvider` registry in `frontend-core` — the correct no-hard-import
  pattern (mirrors `mediaLibraryProviders`), but not worth the core surface until
  a real second consumer exists. Revisit then.

## 8. Abuse protection (deferred, generic)

**No honeypot in the action**, and no per-instance rate-limit (unreliable on
serverless). Abuse protection is a **separate, generic, opt-in concern**: a
dedicated app (e.g. Turnstile/reCAPTCHA) shipping a global orchestr **initware**
(`defineOrchestr.extendRequest`) that runs before every action and
`throw`s `createError({ statusCode: 403 })` on failure. Initware only sees
`{ event, clientEnv }` (not `input`), so the captcha token rides in a **request
header**. This is its own future design doc; withdrawal v1 ships without it.

## 9. Out of scope / future work

- **`ActionOutcome` — universal action-response envelope** *(its own design
  doc).* A core orchestr transport change: every action response is wrapped as
  `ActionOutcome<data>` (`{ ok, data?, messages: Array<{ severity, text, path?,
  code? }> }`), with the envelope applied by the framework (tokens declare only
  their `data`, so it is **not opt-out-able**), validation errors normalized
  in-band, the client unwrapping `data` for back-compat, and consumers migrated.
  Withdrawal is a weak forcing function for it (no server-side field validation),
  so it is decoupled; withdrawal migrates its output from `FeedbackResponse` onto
  `ActionOutcome` when it lands. A stronger first consumer (login /
  address-create / review-create) should prove it.
- **Generic abuse-protection app** (§8).
- **`MailProvider` registry in frontend-core** — when a second server-side mail
  consumer appears.
- **First-party API transport adapters** (Resend/SES/Postmark/…) behind
  `MailTransport`.
- **The wider "essentials apps" family** (SEO, schema.org, …).

## 10. Implementation sequencing & publishing

Cross-repo publish order (the app peer-depends on the token):

1. **monorepo:** add `WithdrawalAction` token + `legal` subpath export to
   `canonical-types`; add `WithdrawalButton`/`WithdrawalForm` (`ui`) and
   `BlockWithdrawalButton` (`ui-app`). **Changesets required** for
   `canonical-types` / `ui` / `ui-app`. Publish canonical-types first.
2. **separate repo:** scaffold `@laioutr/app-essentials-mailer` from
   `app-starter`; implement transport, template, handler, config, server export;
   peer-dep on the published `canonical-types` floor.
3. Wire a project: install + configure the app in `laioutrrc.json`
   (transport/from/recipient), place `BlockWithdrawalButton` in the footer,
   configure its labels (incl. the identifier label).

## 11. Decisions log

- Fields: 3 required (name, orderReference, email); no reason field. **Required
  `orderReference` is legally permitted** (the § 356a contract-identifier field).
- Token: `ecommerce/legal/withdrawal` in `canonical-types`; output =
  `FeedbackResponse` for v1.
- Transport: `MailTransport` interface + nodemailer SMTP adapter; provider-
  agnostic, forward-compatible config; Node runtime assumed.
- Templating: generic MJML form-email template + `html-to-text`.
- Two emails, ordered: store notice (critical) then consumer acknowledgement
  (best-effort).
- Mail API: server-only **module export** from the app; no frontend-core
  registry; loud build break acceptable.
- `ActionOutcome`: **split into its own design doc** as a universal, non-opt-out
  transport envelope; withdrawal ships without it (client-side validation +
  `FeedbackResponse`).
- Abuse protection: deferred, generic initware-based app.
