import { createTransport } from 'nodemailer';
import type { MailMessage, MailTransport, SendResult, SmtpTransportConfig } from './types';

/**
 * SMTP transport backed by nodemailer. SMTP is the universal provider abstraction —
 * Resend/SES/Postmark/Brevo all expose SMTP credentials — so this already supports them.
 */
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
