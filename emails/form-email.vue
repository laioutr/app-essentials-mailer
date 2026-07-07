<template>
  <Html>
    <Head />
    <Body>
      <Container>
        <Text><span v-pre style="font-size:20px;font-weight:bold;color:#111827;">{{heading}}</span></Text>
        <Text><span v-pre>{{intro}}</span></Text>
        <Text><strong><span v-pre>{{formTypeLabel}}</span>:</strong> <span v-pre>{{formType}}</span></Text>
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tbody v-pre>{{#each fields}}<tr><td style="padding:4px 8px;font-weight:bold;">{{label}}</td><td style="padding:4px 8px;">{{value}}</td></tr>{{/each}}</tbody>
        </table>
        <Text><strong><span v-pre>{{submittedAtLabel}}</span>:</strong> <span v-pre>{{submittedAt}}</span> (UTC)</Text>
      </Container>
    </Body>
  </Html>
</template>

<!--
  Generic form-email template for the essentials mailer.

  Every dynamic value is a Handlebars token filled at RUNTIME. Vue never evaluates them:
  each is wrapped in `v-pre` so Vue emits it literally and Maizzle only compiles the
  surrounding structure (Outlook-safe HTML + CSS inlining) around them. (`v-pre` is the
  proven primitive here; Maizzle's `<Raw>` component is the documented equivalent.)

  Scalars:  {{heading}} {{intro}} {{formTypeLabel}} {{formType}}
            {{submittedAtLabel}} {{submittedAt}}

  Field rows: a real Handlebars `{{#each fields}}` loop over {label, value} rows —
  resolved per-request by the runtime renderer, NOT built in JS. This is the seam that
  lets future essentials templates express runtime loops/conditionals ({{#if}}, {{#each}})
  instead of only fixed placeholders. Not withdrawal-specific — reused verbatim.
-->
