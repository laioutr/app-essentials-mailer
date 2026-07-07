<template>
  <Html>
    <Head />
    <Body>
      <Container>
        <Text><span v-pre style="font-size:20px;font-weight:bold;color:#111827;">{{heading}}</span></Text>
        <Text><span v-pre>{{intro}}</span></Text>
        <Text><strong><span v-pre>{{formTypeLabel}}</span>:</strong> <span v-pre>{{formType}}</span></Text>
        <div v-pre>{{{fields}}}</div>
        <Text><strong><span v-pre>{{submittedAtLabel}}</span>:</strong> <span v-pre>{{submittedAt}}</span> (UTC)</Text>
      </Container>
    </Body>
  </Html>
</template>

<!--
  Generic form-email template for the essentials mailer.

  All copy is injected at RUNTIME — every dynamic value is a placeholder wrapped in
  `v-pre` so Vue emits it literally and Maizzle compiles the surrounding structure
  (Outlook-safe HTML + CSS inlining) around it:

    {{heading}} {{intro}} {{formTypeLabel}} {{formType}}
    {{submittedAtLabel}} {{submittedAt}}   and the raw {{{fields}}} slot

  The {{{fields}}} slot is replaced at runtime with a full <table> of label/value rows.
  Not withdrawal-specific — future essentials emails reuse it verbatim.
-->
