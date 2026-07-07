/**
 * Shared Maizzle *build* config for the essentials-mailer family.
 *
 * Intentionally minimal — Maizzle's defaults already produce Outlook-safe, CSS-inlined
 * HTML, and the top-level `components/` dir is auto-discovered without config.
 *
 * NOTE: the brand THEME does not live here. Tailwind CSS 4 defines its theme in CSS
 * (`@theme`), not in JS config, so the Laioutr color/font tokens live in the shared
 * `components/EssentialsLayout.vue` `<style>` block. That component is the reusable
 * theming seam every essentials template consumes as Tailwind utilities (bg-primary,
 * text-ink, font-brand, …). This file remains the seam for pipeline-level build options.
 */
export default {};
