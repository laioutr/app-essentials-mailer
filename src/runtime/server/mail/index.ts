// Server-only public API for the essentials mail backbone.
// Imported by consumers via `@laioutr/app-essentials-mailer/server`. No `#imports`,
// no Nuxt/Nitro globals, no withdrawal specifics — just the reusable transport,
// renderer, and send primitives future essentials apps compose.
export { createSmtpTransport } from './transport/smtp';
export { resolveTransport } from './transport/resolveTransport';
export { renderFormEmail } from './template/renderFormEmail';
export { getShell } from './template/shells';
export { sendMail } from './sendMail';

export type { MailTransport, MailMessage, SendResult, MailerConfig, SmtpTransportConfig } from './transport/types';
export type { FormEmailField, RenderFormEmailOptions, RenderedEmail } from './template/renderFormEmail';
export type { ShellKey } from './template/shells';
