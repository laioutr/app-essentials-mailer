/** SMTP transport connection settings. */
export interface SmtpTransportConfig {
  type: 'smtp';
  host: string;
  port: number;
  secure?: boolean;
  auth: { user: string; pass: string };
}

/** Discriminated by `type`; future providers (resend, postmark, …) add variants. */
export type TransportConfig = SmtpTransportConfig;

/** The private config stored in runtimeConfig[name]. Not validated (by design). */
export interface MailerConfig {
  transport: TransportConfig;
  /** Sender address; may be "Display Name <addr>" form. */
  from: string;
  /** Trader address that receives withdrawal notices. */
  recipient: string;
  /** When not false (default true), the store-notice reply-to is the consumer's email. */
  replyToConsumer?: boolean;
}

/** Module options === the mailer config. */
export type ModuleOptions = MailerConfig;
