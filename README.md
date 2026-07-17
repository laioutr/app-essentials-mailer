# @laioutr/app-essentials-mailer

[![Laioutr][laioutr-src]][laioutr-href]
[![npm version][npm-version-src]][npm-version-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

The shared **email backbone** for the Laioutr essentials-apps family. It provides a
reusable SMTP transport, a precompiled email-template renderer, and a `sendMail`
primitive, plus the orchestr action wiring for the flows it ships.

**v1** handles **withdrawal-form** submissions (German _Widerruf_): it delivers the
consumer's withdrawal to the trader (the critical "store notice", retried once on transient
connection errors) and sends the consumer a best-effort acknowledgement on a durable medium.

## Installation

Add the module to your Laioutr app's `nuxt.config`:

```ts
export default defineNuxtConfig({
  modules: ['@laioutr/app-essentials-mailer'],
})
```

## Configuration

Configuration is stored **private-only** — it is merged into
`runtimeConfig['@laioutr/app-essentials-mailer']` and **never** copied to
`runtimeConfig.public`. **SMTP credentials must never reach a client bundle**; source
them from environment variables in your `nuxt.config` `runtimeConfig` block so they stay
server-side and can be overridden per-environment:

```ts
export default defineNuxtConfig({
  modules: ['@laioutr/app-essentials-mailer'],
  runtimeConfig: {
    '@laioutr/app-essentials-mailer': {
      transport: {
        type: 'smtp',
        host: process.env.SMTP_HOST,
        port: 587,
        secure: false, // true for port 465
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      },
      from: 'Shop <noreply@example.com>', // sender; may be "Display Name <addr>"
      recipient: 'widerruf@example.com', // trader address that receives withdrawal notices
      replyToConsumer: true, // store-notice reply-to = the consumer's email (default true)
      timeZone: 'Europe/Berlin', // optional IANA zone; omitted/invalid values use UTC
      brand: {
        shopName: 'Example Shop', // shown in the email header + copyright line
        shopUrl: 'https://example.com', // optional; header shop name links here
        footerLinks: [
          // optional; rendered in order, ` · `-joined, in the footer
          { label: 'Imprint', url: 'https://example.com/imprint' },
          { label: 'Privacy', url: 'https://example.com/privacy' },
        ],
      },
    },
  },
})
```

| Key                | Type                         | Notes                                                                        |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------------- |
| `transport`        | `{ type: 'smtp', … }`        | SMTP connection settings (`host`, `port`, `secure?`, `auth`).                |
| `from`             | `string`                     | Sender address; `"Display Name <addr>"` accepted.                            |
| `recipient`        | `string`                     | Trader address that receives withdrawal notices.                             |
| `replyToConsumer`  | `boolean` (default `true`)   | When not `false`, the store-notice `reply-to` is the consumer's email.       |
| `timeZone`         | `string` (optional)          | IANA timezone for timestamps and copyright year; omitted/invalid values use `UTC`. |
| `brand`            | `{ shopName, shopUrl?, footerLinks? }` | Shop branding for every email's header + footer (**required**).    |
| `brand.shopName`   | `string`                     | Shop display name — header and `© {year} {shopName}` footer line.            |
| `brand.shopUrl`    | `string` (optional)          | Storefront URL the header shop name links to; plain text when omitted.       |
| `brand.footerLinks`| `{ label, url }[]` (optional)| Footer links (imprint, privacy, …), rendered in order; omitted when empty.   |

`timeZone` affects the local calendar date/time shown in every email and the copyright year
at New Year boundaries. The footer displays the effective canonical IANA identifier so the
timestamp remains unambiguous. Omitted or invalid identifiers fall back to `UTC`.

There is **no config validation** by design — a misconfiguration surfaces as a failed
send at request time, not at boot.

## Server API

Reusable, server-only primitives are exported from the `/server` subpath (no `#imports`,
no Nuxt globals — safe to import from any Nitro server context):

```ts
import {
  sendMail,
  resolveTransport,
  renderFormEmail,
  createSmtpTransport,
} from '@laioutr/app-essentials-mailer/server'
```

- `sendMail(transport, message, options?)` — send one fully-addressed message with retry + per-attempt timeout policy (`{ retries?, timeout? }`).
- `resolveTransport(config)` / `createSmtpTransport(smtp)` — the transport seam.
- `renderFormEmail(opts)` — fill the compiled form-email layout with per-request data → `{ html, text }`.

## Sending mail from a server handler

Inside this module (orchestr actions, server routes, Nitro handlers) use the auto-imported
**`useMailer`** composable rather than wiring the transport by hand. It reads the private
config once, resolves the transport, and hands back a bound sender plus the render context:

```ts
import { useMailer } from '#imports' // auto-imported in server context; the import is optional

// `locale` and `vars` come from the request (e.g. clientEnv.locale + the form input).
const { sendMail, ctx, config } = useMailer(locale)

await sendMail(
  {
    ...renderWithdrawalStoreNotice(ctx, vars), // a template → { subject, html, text }
    from: config.from,
    to: config.recipient,
    replyTo: vars.email,
  },
  { retries: 1 }, // SendOptions: retries (default 0) + per-attempt timeout (default 10s)
)
```

- `useMailer(locale)` → `{ sendMail, ctx, config }`.
- `sendMail(message, options?)` — the delivery primitive **bound to the config's transport**, so no `transport` argument here (unlike the `/server` export).
- `ctx` — the `MailRenderContext` (locale, timezone, brand) every template takes as its first argument.
- `config` — the resolved `MailerConfig`, for addressing (`from`, `recipient`, `replyToConsumer`).

A template maps `(ctx, vars)` → `{ subject, html, text }`; spread that over the addressing
fields (`from`, `to`, optional `replyTo`) to form the `MailMessage` that `sendMail` delivers.

## How emails are authored

Templates live in `emails/*.vue` and are authored with **[Maizzle](https://maizzle.com)**
(Vue-SFC email framework: Outlook-safe HTML + CSS inlining). They are **precompiled at
build time** (`pnpm build:emails`) into HTML **layouts** under
`src/runtime/emails/compiled/` — Maizzle is a **devDependency and never ships in a
consumer's runtime bundle**.

Dynamic values are **not** evaluated by Vue. Each token is wrapped in `v-pre` so it
survives compilation literally, and at runtime the layout is filled with
**[Handlebars](https://handlebarsjs.com)** — a small runtime template engine. This means
templates express real **runtime** logic (`{{#each}}` loops, `{{#if}}` conditionals), not
just fixed placeholders, while keeping the heavy authoring pipeline out of production.
Handlebars' default `{{ }}` escaping HTML-escapes all interpolated data, so user-supplied
values can never inject markup. Plaintext is derived from the rendered HTML via
`html-to-text`.

## Extensibility (future)

The mailer is built to become the shared email backbone for the essentials-apps
family. Multi-app template contribution is **not implemented in v1**, but the seams exist:

- **Exportable Maizzle config** (`maizzle.config.mjs`) — the single styling/pipeline source.
- **Typed layout renderers** — each compiled layout has its own typed renderer (`renderFormEmail` for the `form-email` layout); a new layout adds a new renderer, and new messages add new templates over it.
- **Runtime template engine** (Handlebars) — contributed templates can use runtime `{{#each}}`/`{{#if}}`, not only fixed placeholders.
- **Configurable compile globs** (`scripts/build-emails.mjs` `templateDirs` list) — v1 lists only this app's `emails/`.
- **Shared server API** (`@laioutr/app-essentials-mailer/server`) — `sendMail`, `resolveTransport`, `renderFormEmail`.

When a second essentials app needs to send email, add a **registration hook** so apps
contribute a raw-template directory (+ optional components) that is compiled **at the
consumer build** against the shared config into Nitro server assets, then rendered/sent
through the shared API. At that point `@maizzle/framework` moves from a devDependency to a
build-time dependency (present at the consumer build, still tree-shaken from the runtime
bundle). This mirrors how Laioutr apps already contribute `orchestrDirs`/`sections`/`blocks`.

## Development

Create a `.npmrc` from `.npmrc.config` and fill in `NPM_LAIOUTR_TOKEN` (needed for
`@laioutr-*` installs), then:

```bash
pnpm install
pnpm dev:prepare   # build:emails + module stub + prepare playground
pnpm test          # build:emails + vitest
pnpm lint
```

`pnpm build:emails` regenerates the compiled layouts from `emails/*.vue` — rerun it after
editing a template.

## License

[MIT](./LICENSE.md)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@laioutr/app-essentials-mailer/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@laioutr/app-essentials-mailer
[license-src]: https://img.shields.io/npm/l/@laioutr/app-essentials-mailer.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@laioutr/app-essentials-mailer
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
[laioutr-src]: https://img.shields.io/badge/%F0%9F%A6%99_Laioutr_App-702DCE?labelColor=020420
[laioutr-href]: https://laioutr.com
