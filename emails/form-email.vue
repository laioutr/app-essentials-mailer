<template>
  <EssentialsLayout>
    <table role="presentation" cellpadding="0" cellspacing="0" class="w-full bg-page">
      <tr>
        <td align="center" class="px-3 py-8">
          <Container class="max-w-[600px]">
            <table role="presentation" cellpadding="0" cellspacing="0" class="w-full bg-white rounded-xl border border-edge">
              <!-- brand accent bar -->
              <tr>
                <td class="h-[5px] text-[5px] leading-[5px] bg-primary rounded-t-xl">&nbsp;</td>
              </tr>
              <!-- shop-name header (linked when a storefront URL is configured) -->
              <tr>
                <td class="px-8 pt-6 pb-5 border-b border-page font-brand">
                  <span v-pre>{{#if shopUrl}}<a href="{{shopUrl}}" class="text-[17px] font-bold text-primary no-underline">{{shopName}}</a>{{else}}<span class="text-[17px] font-bold text-primary">{{shopName}}</span>{{/if}}</span>
                </td>
              </tr>
              <!-- heading -->
              <tr>
                <td class="px-8 pt-6 pb-1 font-brand">
                  <span v-pre class="text-[22px] font-bold leading-tight text-ink">{{heading}}</span>
                </td>
              </tr>
              <!-- intro -->
              <tr>
                <td class="px-8 pt-2 pb-6 font-brand">
                  <span v-pre class="text-[15px] leading-relaxed text-body">{{intro}}</span>
                </td>
              </tr>
              <!-- form-type callout (brand pale-badge) -->
              <tr>
                <td class="px-8 pb-2">
                  <table role="presentation" cellpadding="0" cellspacing="0" class="w-full bg-accent-tint rounded-lg">
                    <tr>
                      <td class="px-[18px] py-[14px] text-[14px] font-brand">
                        <span v-pre class="font-semibold text-accent-label">{{formTypeLabel}}</span><span class="text-accent-soft"> &middot; </span><span v-pre class="font-bold text-accent-strong">{{formType}}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- submission detail rows -->
              <tr>
                <td class="px-8 pt-4 pb-2">
                  <table role="presentation" cellpadding="0" cellspacing="0" class="w-full">
                    <tbody v-pre>{{#each fields}}<tr><td class="py-3 align-top text-[14px] text-body border-b border-page font-brand">{{label}}</td><td class="py-3 pl-4 align-top text-right text-[14px] font-medium text-ink border-b border-page font-brand">{{value}}</td></tr>{{/each}}</tbody>
                  </table>
                </td>
              </tr>
              <!-- footer: submitted-at meta + optional links + copyright -->
              <tr>
                <td class="px-8 pt-5 pb-7 border-t border-page font-brand">
                  <div class="text-[13px] text-muted"><span v-pre><span class="font-semibold">{{submittedAtLabel}}</span>: {{submittedAt}} (UTC)</span></div>
                  <div v-pre>{{#if footerLinks}}<div class="pt-[14px] text-[13px] leading-relaxed">{{#each footerLinks}}<a href="{{url}}" class="font-medium text-accent-label no-underline">{{label}}</a>{{#unless @last}}<span class="text-sep"> &middot; </span>{{/unless}}{{/each}}</div>{{/if}}</div>
                  <div class="pt-[10px] text-[12px] text-muted"><span v-pre>&copy; {{year}} {{shopName}}</span></div>
                </td>
              </tr>
            </table>
          </Container>
        </td>
      </tr>
    </table>
  </EssentialsLayout>
</template>

<!--
  Generic form-email template for the essentials mailer.

  Authored the idiomatic Maizzle way: <EssentialsLayout> supplies the brand @theme +
  <Tailwind> context (see components/EssentialsLayout.vue), and every style here is a
  Tailwind utility class that Maizzle INLINES into a `style="…"` attribute at build. No
  hand-written hex — the palette lives once in the shared @theme (bg-primary, text-ink,
  text-body, text-muted, bg-accent-tint, border-edge/-page, font-brand, …).

  Dynamic values are Handlebars tokens filled at RUNTIME. Each token-bearing element is
  `v-pre` so Vue emits the `{{ }}` literally; Maizzle still inlines that element's Tailwind
  classes (verified: classes inline even on elements inside a v-pre {{#each}} loop, while
  the tokens pass through untouched). `<Container>` supplies the Outlook ghost-table (600px)
  wrapper; `max-w-[600px]` constrains modern clients.

  Runtime conditionals/loops (the seam this architecture exists for):
    {{#if shopUrl}}      header shop name is a link vs. plain text
    {{#each fields}}      one detail row per field
    {{#if footerLinks}} + {{#each footerLinks}}/{{#unless @last}}  ` · `-joined footer links

  Scalars:  {{heading}} {{intro}} {{formTypeLabel}} {{formType}}
            {{submittedAtLabel}} {{submittedAt}} {{shopName}} {{shopUrl}} {{year}}

  Not withdrawal-specific — reused verbatim by any essentials form email.
-->
