<template>
  <Html :lang="'{{htmlLang}}'" :dir="'{{textDirection}}'">
    <Head>
      <style>
        @import "@maizzle/tailwindcss";

        /*
          Laioutr brand theme — the single shared design-token source for every
          essentials-mailer email. Values are the resolved @laioutr/ui-tokens
          light-theme tokens (_theme-laioutr-light.css). Templates author with the
          Tailwind utilities these generate (bg-primary, text-ink, font-brand, …);
          Maizzle inlines them to literal hex at build, so mail clients — which strip
          <style>/CSS variables — still get correct colors.

          Tailwind CSS 4 defines the theme in CSS (@theme), not in maizzle.config.mjs;
          this component is that shared config, and also the reusable skeleton.
        */
        @theme {
          --color-primary: #702cce;        /* --primary-9  / laioutr-purple-9  (brand/accent) */
          --color-accent-tint: #f3efff;    /* --primary-3   (form-type callout background)     */
          --color-accent-label: #743dcd;   /* --primary-11  (callout label + footer links)     */
          --color-accent-strong: #391b6a;  /* --primary-12  (callout value)                    */
          --color-accent-soft: #b091fd;    /* laioutr-purple-8 (callout separator dot)         */
          --color-page: #eff0f3;           /* --stone-grey-3 (page canvas + hairline dividers)  */
          --color-edge: #e7e8ec;           /* --stone-grey-4 (card border)                     */
          --color-ink: #221f1e;            /* --font-color-black (headings + field values)     */
          --color-body: #666360;           /* --font-color-grey  (intro + field labels)        */
          --color-muted: #8b8d98;          /* --stone-grey-9 (footer meta + copyright)         */
          --color-sep: #b9bbc6;            /* --stone-grey-8 (footer link separator)           */
          --font-brand: Lexend, Arial, Helvetica, sans-serif; /* --font-family-body            */
        }
      </style>
    </Head>
    <Tailwind>
      <Body
        :xml-lang="'{{htmlLang}}'"
        :dir="'{{textDirection}}'"
        class="m-0 p-0 w-full bg-page font-brand"
      >
        <slot />
      </Body>
    </Tailwind>
  </Html>
</template>

<!--
  Shared themed skeleton for essentials-mailer emails. Provides the brand @theme (above),
  the <Tailwind> processing context, and a page-canvas <Body>. Each template supplies its
  own card via the default slot. Auto-discovered by Maizzle from the top-level components/ dir.
-->
