# Email Locale Metadata and Configurable Timezone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render language-correct HTML email metadata and format displayed timestamps and copyright years in an optional deployment-configured IANA timezone.

**Architecture:** Add one focused locale/timezone resolver under the server mail runtime. The withdrawal copy selector and generic renderer share its supported-language fallback, while the renderer threads the resolved language, direction, canonical timezone, timestamp, and timezone-aware year through the runtime Handlebars shell. The optional private root config reaches both withdrawal messages through the existing dependency-injected render seam.

**Tech Stack:** TypeScript 5.9, Nuxt 3 private runtime config, Maizzle 6/Vue SFC templates, Handlebars 4, `Intl.DateTimeFormat`, Vitest 3.

## Global Constraints

- Work directly on `main`; do not create or switch branches or create a worktree.
- Preserve the user's unrelated working-tree changes in `src/module.ts`, `src/runtime/server/middleware/index.ts`, and `src/runtime/app/`.
- Never use `git add -A` or `git add .`; stage only the exact feature files listed in each commit step.
- `timeZone?: string` is private root `MailerConfig` configuration and never enters `runtimeConfig.public`.
- Accept IANA timezone identifiers such as `Europe/Berlin`.
- Omitted or invalid timezone identifiers fall back to `UTC` at render time; do not add boot-time config validation.
- German and English remain the only supported content languages; unsupported requested languages use English copy and `lang="en" dir="ltr"`.
- Preserve the full requested BCP-47 locale for regional timestamp formatting.
- Do not add RTL behavior before an RTL content translation exists.
- Keep `RenderFormEmailOptions.timeZone` and the injected withdrawal render option optional for backward compatibility.
- Use the effective canonical IANA timezone for timestamp formatting, its visible footer marker, and copyright-year calculation.
- Regenerate `src/runtime/emails/compiled/form-email.ts` with `pnpm build:emails`; never hand-edit it.
- Follow TDD: observe each targeted test fail before implementing its production change.
- Commit at the explicit commit steps in this plan; these commits are authorized by the approved plan.

## File Structure

- Create `src/runtime/server/mail/i18n.ts` — resolve supported content language, direction, full format locale, and canonical/fallback timezone.
- Create `test/email-i18n.test.ts` — unit-test locale fallback and timezone normalization independently of templates.
- Modify `src/runtime/server/mail/withdrawal/strings.ts` — reuse the shared supported-language resolver.
- Modify `components/EssentialsLayout.vue` — feed literal runtime Handlebars metadata tokens into Maizzle's `Html` and `Body` components.
- Modify `emails/form-email.vue` — replace the fixed `(UTC)` marker with the runtime effective timezone token.
- Modify `src/runtime/server/mail/template/renderFormEmail.ts` — resolve context, format in the effective timezone, and supply all runtime shell values.
- Modify `src/runtime/emails/compiled/form-email.ts` — generated Maizzle shell containing the new runtime tokens.
- Modify `test/compiled-shell.test.ts` — verify metadata and timezone tokens survive Maizzle compilation.
- Modify `test/render-form-email.test.ts` — verify metadata, valid/default/invalid timezone behavior, and New Year handling.
- Modify `src/config-types.ts` — expose optional private root `timeZone` configuration.
- Modify `src/runtime/server/mail/withdrawal/handleWithdrawal.ts` — pass configured timezone into both render calls.
- Modify `test/handle-withdrawal.test.ts` — verify both messages receive the configured timezone.
- Modify `playground/nuxt.config.ts` — demonstrate `Europe/Berlin` in development.
- Modify `README.md` — document the option and fallback semantics.

---

### Task 1: Shared email locale and timezone resolver

**Files:**
- Create: `src/runtime/server/mail/i18n.ts`
- Create: `test/email-i18n.test.ts`
- Modify: `src/runtime/server/mail/withdrawal/strings.ts:1-58`
- Test: `test/withdrawal-strings.test.ts`

**Interfaces:**
- Produces: `resolveContentLanguage(locale: string): EmailContentLanguage`.
- Produces: `resolveTimeZone(timeZone?: string): string`, returning a canonical valid IANA identifier or `UTC`.
- Produces: `resolveEmailLocale(locale: string, timeZone?: string): EmailLocaleContext`.
- `EmailLocaleContext` is `{ contentLanguage: 'de' | 'en'; direction: 'ltr' | 'rtl'; formatLocale: string; timeZone: string }`.
- The renderer in Task 2 consumes `resolveEmailLocale`; withdrawal strings consume `resolveContentLanguage` in this task.

- [ ] **Step 1: Write the failing resolver tests**

Create `test/email-i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  resolveContentLanguage,
  resolveEmailLocale,
  resolveTimeZone,
} from '../src/runtime/server/mail/i18n';

describe('email i18n resolution', () => {
  it('selects German by language subtag and otherwise falls back to English', () => {
    expect(resolveContentLanguage('de-CH')).toBe('de');
    expect(resolveContentLanguage('en-GB')).toBe('en');
    expect(resolveContentLanguage('fr-FR')).toBe('en');
  });

  it('preserves the full formatting locale and describes supported content', () => {
    expect(resolveEmailLocale('de-AT', 'Europe/Berlin')).toEqual({
      contentLanguage: 'de',
      direction: 'ltr',
      formatLocale: 'de-AT',
      timeZone: 'Europe/Berlin',
    });
  });

  it('uses UTC when no timezone is configured', () => {
    expect(resolveTimeZone()).toBe('UTC');
  });

  it('canonicalizes valid zones and falls back to UTC for invalid zones', () => {
    expect(resolveTimeZone('europe/berlin')).toBe('Europe/Berlin');
    expect(resolveTimeZone('Not/AZone')).toBe('UTC');
  });
});
```

- [ ] **Step 2: Run the resolver test and verify it fails for the missing module**

Run:

```bash
pnpm vitest run test/email-i18n.test.ts
```

Expected: FAIL because `src/runtime/server/mail/i18n.ts` cannot be resolved.

- [ ] **Step 3: Implement the focused resolver**

Create `src/runtime/server/mail/i18n.ts`:

```ts
export type EmailContentLanguage = 'de' | 'en';
export type EmailTextDirection = 'ltr' | 'rtl';

export interface EmailLocaleContext {
  contentLanguage: EmailContentLanguage;
  direction: EmailTextDirection;
  formatLocale: string;
  timeZone: string;
}

/** Content languages the mailer currently ships; unsupported languages use English copy. */
export function resolveContentLanguage(locale: string): EmailContentLanguage {
  return locale.split('-')[0].toLowerCase() === 'de' ? 'de' : 'en';
}

/** Canonical IANA timezone, with UTC as the compatibility fallback. */
export function resolveTimeZone(timeZone?: string): string {
  if (!timeZone) return 'UTC';

  try {
    return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return 'UTC';
    throw error;
  }
}

export function resolveEmailLocale(locale: string, timeZone?: string): EmailLocaleContext {
  return {
    contentLanguage: resolveContentLanguage(locale),
    direction: 'ltr',
    formatLocale: locale,
    timeZone: resolveTimeZone(timeZone),
  };
}
```

The `RangeError` catch is deliberately narrow: invalid timezone identifiers fall back, while unrelated failures propagate.

- [ ] **Step 4: Make withdrawal strings use the shared content-language resolver**

Apply this exact change to `src/runtime/server/mail/withdrawal/strings.ts`:

```diff
+import { resolveContentLanguage } from '../i18n';
+
 export interface WithdrawalStrings {
```

Replace `getWithdrawalStrings` with:

```ts
/** Localized withdrawal copy, keyed by supported content language, English fallback. */
export function getWithdrawalStrings(locale: string): WithdrawalStrings {
  return STRINGS[resolveContentLanguage(locale)];
}
```

- [ ] **Step 5: Run resolver and withdrawal-copy tests**

Run:

```bash
pnpm vitest run test/email-i18n.test.ts test/withdrawal-strings.test.ts
```

Expected: both files PASS, including German selection and unsupported-locale English fallback.

- [ ] **Step 6: Commit the resolver**

```bash
git add src/runtime/server/mail/i18n.ts src/runtime/server/mail/withdrawal/strings.ts test/email-i18n.test.ts
git commit -m "feat: centralize email locale and timezone resolution"
```

Do not stage any pre-existing user changes.

---

### Task 2: Runtime language metadata and timezone-aware form rendering

**Files:**
- Modify: `components/EssentialsLayout.vue:1-47`
- Modify: `emails/form-email.vue:50-89`
- Modify: `src/runtime/server/mail/template/renderFormEmail.ts:1-93`
- Modify (generated): `src/runtime/emails/compiled/form-email.ts`
- Modify: `test/compiled-shell.test.ts:1-42`
- Modify: `test/render-form-email.test.ts:1-115`

**Interfaces:**
- Consumes: `resolveEmailLocale(locale: string, timeZone?: string): EmailLocaleContext` from Task 1.
- Extends: `RenderFormEmailOptions` with `timeZone?: string`.
- Supplies Handlebars values: `htmlLang`, `textDirection`, `submittedAt`, `timeZone`, and timezone-aware `year`.
- Keeps the existing `renderFormEmail(opts): { html: string; text: string }` public API shape.

- [ ] **Step 1: Update the renderer fixture shell with runtime metadata and timezone tokens**

In `test/render-form-email.test.ts`, replace the `shell` array with:

```ts
const shell = [
  '<html lang="{{htmlLang}}" dir="{{textDirection}}">',
  '<body xml:lang="{{htmlLang}}" dir="{{textDirection}}">',
  '{{#if shopUrl}}<a href="{{shopUrl}}">{{shopName}}</a>{{else}}<span>{{shopName}}</span>{{/if}}',
  '<p><span>{{heading}}</span></p>',
  '<p><span>{{intro}}</span></p>',
  '<p><strong><span>{{formTypeLabel}}</span>:</strong> <span>{{formType}}</span></p>',
  '<table><tbody>{{#each fields}}<tr><td>{{label}}</td><td>{{value}}</td></tr>{{/each}}</tbody></table>',
  '<p><strong><span>{{submittedAtLabel}}</span>:</strong> <span>{{submittedAt}}</span> ({{timeZone}})</p>',
  '{{#if footerLinks}}<nav>{{#each footerLinks}}<a href="{{url}}">{{label}}</a>{{#unless @last}} · {{/unless}}{{/each}}</nav>{{/if}}',
  '<small>© {{year}} {{shopName}}</small>',
  '</body>',
  '</html>',
].join('');
```

- [ ] **Step 2: Add failing metadata, timezone, and calendar-year renderer tests**

Replace the existing English UTC and German chrome tests at `test/render-form-email.test.ts:52-63` with:

```ts
  it('formats submittedAt in UTC by default and uses English metadata and chrome', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('<body xml:lang="en" dir="ltr">');
    expect(html).toContain('July 6, 2026 at 10:30:00 AM');
    expect(html).toContain('(UTC)');
    expect(html).toContain('Form type');
    expect(html).toContain('Received at');
  });

  it('uses German metadata and chrome for a de locale', () => {
    const { html } = renderFormEmail({ ...base, locale: 'de-DE' });
    expect(html).toContain('<html lang="de" dir="ltr">');
    expect(html).toContain('<body xml:lang="de" dir="ltr">');
    expect(html).toContain('Formulartyp');
    expect(html).toContain('Eingegangen am');
  });

  it('uses English copy metadata for an unsupported content language', () => {
    const { html } = renderFormEmail({ ...base, locale: 'fr-FR' });
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('Form type');
    expect(html).toContain('Received at');
  });

  it('formats the timestamp in a configured canonical IANA timezone', () => {
    const { html } = renderFormEmail({ ...base, timeZone: 'europe/berlin' });
    expect(html).toContain('July 6, 2026 at 12:30:00 PM');
    expect(html).toContain('(Europe/Berlin)');
  });

  it('falls back to UTC when the configured timezone is invalid', () => {
    const { html } = renderFormEmail({ ...base, timeZone: 'Not/AZone' });
    expect(html).toContain('July 6, 2026 at 10:30:00 AM');
    expect(html).toContain('(UTC)');
  });

  it('derives the copyright year in the effective timezone', () => {
    const { html } = renderFormEmail({
      ...base,
      submittedAt: new Date('2025-12-31T23:30:00Z'),
      timeZone: 'Europe/Berlin',
    });
    expect(html).toContain('January 1, 2026 at 12:30:00 AM');
    expect(html).toContain('© 2026 Example Shop');
  });
```

Update the existing header/copyright test comments so they no longer describe the year as UTC:

```ts
  it('renders the shop-name header (linked) and a footer copyright with the shop name + year', () => {
    const { html } = renderFormEmail(base);
    expect(html).toContain('<a href="https://shop.example">Example Shop</a>');
    expect(html).toContain('© 2026 Example Shop');
  });
```

- [ ] **Step 3: Add failing generated-shell token assertions**

In `test/compiled-shell.test.ts`, add `{{htmlLang}}`, `{{textDirection}}`, and `{{timeZone}}` to the scalar token list:

```ts
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
      expect(formEmailShell).toContain(token);
    }
```

Add this test before the inlined-style test:

```ts
  it('preserves runtime language and direction metadata in every Maizzle wrapper', () => {
    expect(formEmailShell).toContain(
      '<html lang="{{htmlLang}}" dir="{{textDirection}}"',
    );
    expect(formEmailShell).toContain(
      '<body xml:lang="{{htmlLang}}" dir="{{textDirection}}"',
    );
    expect(formEmailShell).toContain(
      'role="article" aria-roledescription="email" lang="{{htmlLang}}" dir="{{textDirection}}"',
    );
  });
```

Maizzle's `Body` component applies the same language and direction to its inner accessibility article wrapper, so the third assertion prevents a partially localized shell.

- [ ] **Step 4: Run the focused tests and observe the old static metadata/fixed UTC behavior fail**

Run:

```bash
pnpm vitest run test/compiled-shell.test.ts test/render-form-email.test.ts
```

Expected: FAIL because the generated shell still contains static `en`/`ltr`, the renderer does not supply the new tokens, and configured timezone is ignored.

- [ ] **Step 5: Put literal Handlebars metadata tokens through the Maizzle component props**

Change the opening `Html` tag in `components/EssentialsLayout.vue` to:

```vue
<Html :lang="'{{htmlLang}}'" :dir="'{{textDirection}}'">
```

Change the `Body` block to:

```vue
<Body
  :xml-lang="'{{htmlLang}}'"
  :dir="'{{textDirection}}'"
  class="m-0 p-0 w-full bg-page font-brand"
>
  <slot />
</Body>
```

The bound values are JavaScript string literals at Maizzle build time. Maizzle therefore emits literal Handlebars tokens for runtime resolution while retaining its normal `Html`/`Body` behavior, including the accessibility article wrapper.

- [ ] **Step 6: Replace the fixed UTC footer marker with the runtime effective timezone**

In `emails/form-email.vue`, replace the submitted-at footer line with:

```vue
<div class="text-[13px] text-muted"><span v-pre><span class="font-semibold">{{submittedAtLabel}}</span>: {{submittedAt}} ({{timeZone}})</span></div>
```

Replace the scalar-token comment at the bottom with:

```vue
  Scalars:  {{heading}} {{intro}} {{formTypeLabel}} {{formType}}
            {{submittedAtLabel}} {{submittedAt}} {{timeZone}}
            {{htmlLang}} {{textDirection}} {{shopName}} {{shopUrl}} {{year}}
```

- [ ] **Step 7: Make the renderer consume the resolved locale/timezone context**

Add this import to `src/runtime/server/mail/template/renderFormEmail.ts` after the package imports:

```ts
import { resolveEmailLocale } from '../i18n';
```

Replace the locale option comment and add optional timezone configuration:

```ts
  /** BCP-47 locale used for supported-language selection and regional date formatting. */
  locale: string;
  /** IANA timezone for displayed dates; omitted or invalid values use UTC. */
  timeZone?: string;
```

Replace the beginning of `renderFormEmail` through the formatter declaration with:

```ts
export function renderFormEmail(opts: RenderFormEmailOptions): RenderedEmail {
  const { contentLanguage, direction, formatLocale, timeZone } = resolveEmailLocale(
    opts.locale,
    opts.timeZone,
  );
  const chrome = CHROME[contentLanguage];
  const submittedAt = new Intl.DateTimeFormat(formatLocale, {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone,
  }).format(opts.submittedAt);
  const year = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    timeZone,
  }).format(opts.submittedAt);
```

Replace the complete Handlebars data object with:

```ts
  const html = compileShell(opts.shell)({
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
    shopName: opts.shopName,
    shopUrl: opts.shopUrl,
    footerLinks: opts.footerLinks,
    year,
  });
```

Keep plaintext conversion and the return value unchanged:

```ts
  const text = convert(html, { wordwrap: false });
  return { html, text };
}
```

- [ ] **Step 8: Regenerate the Maizzle shell**

Run:

```bash
pnpm build:emails
```

Expected: exit 0 and `src/runtime/emails/compiled/form-email.ts` changes. Do not edit that generated file manually.

- [ ] **Step 9: Run focused rendering tests**

Run:

```bash
pnpm vitest run test/email-i18n.test.ts test/compiled-shell.test.ts test/render-form-email.test.ts
```

Expected: all tests PASS. Existing loop, condition, escaping, and plaintext tests must remain green.

- [ ] **Step 10: Commit runtime-localized rendering**

```bash
git add components/EssentialsLayout.vue emails/form-email.vue src/runtime/server/mail/template/renderFormEmail.ts src/runtime/emails/compiled/form-email.ts test/compiled-shell.test.ts test/render-form-email.test.ts
git commit -m "feat: localize email metadata and display timezone"
```

Do not stage the user's unrelated working-tree files.

---

### Task 3: Private config propagation and documentation

**Files:**
- Modify: `src/config-types.ts:30-41`
- Modify: `src/runtime/server/mail/withdrawal/handleWithdrawal.ts:12-23,94-109,127-135`
- Modify: `test/handle-withdrawal.test.ts:1-91`
- Modify: `playground/nuxt.config.ts:13-25`
- Modify: `README.md:34-75`

**Interfaces:**
- Consumes: optional `RenderFormEmailOptions.timeZone` from Task 2.
- Extends: `MailerConfig` with optional private root `timeZone?: string`.
- Extends: withdrawal `RenderEmail` options with `timeZone?: string`.
- Produces: both withdrawal render calls receive `config.timeZone` unchanged; renderer normalization remains the single fallback point.

- [ ] **Step 1: Add a failing withdrawal propagation test**

Append this test inside the `describe('handleWithdrawal', ...)` block in `test/handle-withdrawal.test.ts`:

```ts
  it('passes the configured timezone to both rendered messages', async () => {
    const { transport } = recorder();
    const render = vi.fn(renderEmail);

    await handleWithdrawal({
      input,
      locale: 'de-DE',
      config: cfg({ timeZone: 'Europe/Berlin' }),
      transport,
      renderEmail: render,
      now,
    });

    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ timeZone: 'Europe/Berlin' }),
    );
    expect(render).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ timeZone: 'Europe/Berlin' }),
    );
  });
```

- [ ] **Step 2: Run the propagation test and verify it fails**

Run:

```bash
pnpm vitest run test/handle-withdrawal.test.ts -t "passes the configured timezone"
```

Expected: FAIL because neither render call currently includes `timeZone`.

- [ ] **Step 3: Add the optional private root config type**

In `src/config-types.ts`, insert this property between `replyToConsumer` and `brand`:

```ts
  /** IANA timezone for displayed dates; omitted or invalid values use UTC. */
  timeZone?: string;
```

Because `RuntimeConfigModulePrivate` extends `MailerConfig` and the module only writes `runtimeConfig[name]`, no public-config change is needed.

- [ ] **Step 4: Thread the configured timezone into both render calls**

Add the optional property to `RenderEmail` in `src/runtime/server/mail/withdrawal/handleWithdrawal.ts`:

```ts
  locale: string;
  timeZone?: string;
  shopName: string;
```

In the store render call, place the configured timezone after `locale`:

```ts
    submittedAt,
    locale,
    timeZone: config.timeZone,
    ...brand,
```

Make the identical change to the consumer acknowledgement render call:

```ts
    submittedAt,
    locale,
    timeZone: config.timeZone,
    ...brand,
```

Do not normalize here; `renderFormEmail` owns canonicalization and fallback for both direct server callers and the withdrawal flow.

- [ ] **Step 5: Run the complete withdrawal tests**

Run:

```bash
pnpm vitest run test/handle-withdrawal.test.ts test/withdrawal-strings.test.ts
```

Expected: PASS, including two configured-timezone render calls and unchanged delivery/retry behavior.

- [ ] **Step 6: Demonstrate the option in the playground**

In `playground/nuxt.config.ts`, add this property after `recipient`:

```ts
    timeZone: 'Europe/Berlin',
```

- [ ] **Step 7: Document configuration and fallback behavior**

In the README configuration example, add this property after `replyToConsumer`:

```ts
      timeZone: 'Europe/Berlin', // optional IANA zone; omitted/invalid values use UTC
```

Add this table row after `replyToConsumer`:

```markdown
| `timeZone`         | `string` (optional)          | IANA timezone for timestamps and copyright year; omitted/invalid values use `UTC`.       |
```

After the table, add:

```markdown
`timeZone` affects the local calendar date/time shown in every email and the copyright year
at New Year boundaries. The footer displays the effective canonical IANA identifier so the
timestamp remains unambiguous. Omitted or invalid identifiers fall back to `UTC`.
```

Retain the existing no-validation paragraph immediately after this new explanation.

- [ ] **Step 8: Run tests, lint, and type checks for the config seam**

Run:

```bash
pnpm vitest run test/handle-withdrawal.test.ts test/render-form-email.test.ts
pnpm lint
pnpm test:types
```

Expected: all commands exit 0. Type checks must confirm the module option, private runtime config, withdrawal render contract, and direct renderer option agree.

- [ ] **Step 9: Commit config propagation and docs**

```bash
git add src/config-types.ts src/runtime/server/mail/withdrawal/handleWithdrawal.ts test/handle-withdrawal.test.ts playground/nuxt.config.ts README.md
git commit -m "feat: configure email display timezone"
```

Do not stage `src/module.ts`, `src/runtime/server/middleware/index.ts`, or `src/runtime/app/`.

---

### Task 4: Full verification and built-output exercise

**Files:**
- Verify only; do not create persistent files.

**Interfaces:**
- Exercises: package test suite, lint, TypeScript declarations, production build, generated Maizzle shell, public server renderer, locale metadata, valid timezone formatting, invalid timezone fallback, and timezone-aware New Year handling.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
pnpm test
pnpm lint
pnpm test:types
pnpm prepack
```

Expected: all four commands exit 0. `pnpm test` rebuilds the Maizzle shell before Vitest; `pnpm prepack` produces the package distribution successfully.

- [ ] **Step 2: Exercise the built public server API end to end**

Run this exact in-memory check against the built distribution:

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import {
  getShell,
  renderFormEmail,
} from './dist/runtime/server/mail/index.js';

const base = {
  shell: getShell('form-email'),
  heading: 'Eingangsbestätigung Ihres Widerrufs',
  intro: 'Wir bestätigen den Eingang Ihres Widerrufs.',
  formType: 'Widerruf',
  fields: [{ label: 'Name', value: 'Alice Example' }],
  submittedAt: new Date('2025-12-31T23:30:00Z'),
  locale: 'de-DE',
  shopName: 'Example Shop',
};

const berlin = renderFormEmail({ ...base, timeZone: 'Europe/Berlin' });
assert.match(berlin.html, /<html lang="de" dir="ltr"/);
assert.match(berlin.html, /<body xml:lang="de" dir="ltr"/);
assert.match(berlin.html, /1\. Januar 2026 um 00:30:00/);
assert.match(berlin.html, /\(Europe\/Berlin\)/);
assert.match(berlin.html, /© 2026 Example Shop/);
assert.doesNotMatch(berlin.html, /\{\{/);
assert.match(berlin.text, /Europe\/Berlin/);

const fallback = renderFormEmail({ ...base, locale: 'fr-FR', timeZone: 'Not/AZone' });
assert.match(fallback.html, /<html lang="en" dir="ltr"/);
assert.match(fallback.html, /\(UTC\)/);

console.log('built renderer verification passed');
NODE
```

Expected output:

```text
built renderer verification passed
```

This observes the generated Maizzle shell and runtime Handlebars renderer together rather than testing only an isolated helper.

- [ ] **Step 3: Invoke the project verification skill before claiming completion**

Invoke `verify` with the requirement: verify runtime email `lang`/`dir`, configured `Europe/Berlin` formatting, invalid-zone UTC fallback, and the New Year copyright year through the built server API. If it identifies a missing runtime observation, perform that observation and record the exact result.

Expected: verification passes with concrete observed output. Do not claim completion if the verification skill reports an unresolved failure.

- [ ] **Step 4: Inspect only the feature commits and preserve unrelated work**

Run:

```bash
git log -4 --oneline
git status --short
git diff --check
```

Expected:

- The three implementation commits are present after the design commit.
- `git diff --check` exits 0.
- Any remaining status entries are only the user's pre-existing unrelated changes (`src/module.ts`, `src/runtime/server/middleware/index.ts`, and `src/runtime/app/`) unless the user changed additional files during execution.
- No implementation file from this plan remains uncommitted.

Do not amend, squash, push, or clean the user's unrelated changes.
