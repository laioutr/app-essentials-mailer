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

/** A labeled footer link (e.g. imprint, privacy policy, contact). */
export interface FooterLink {
  label: string;
  /** Absolute URL. Comes from config (trusted); still HTML-escaped when rendered. */
  url: string;
}

/** Shop branding shown in the email header and footer. */
export interface MailerBrandConfig {
  /** Shop / store display name shown in the header and the footer copyright line. */
  shopName: string;
  /** Optional storefront URL the header shop name links to. Plain text when omitted. */
  shopUrl?: string;
  /** Optional footer links (imprint, privacy, contact, …), rendered in order. */
  footerLinks?: FooterLink[];
}

/** The private config stored in runtimeConfig[name]. Not validated (by design). */
export interface MailerConfig {
  transport: TransportConfig;
  /** Sender address; may be "Display Name <addr>" form. */
  from: string;
  /** Trader address that receives withdrawal notices. */
  recipient: string;
  /** When not false (default true), the store-notice reply-to is the consumer's email. */
  replyToConsumer?: boolean;
  /** IANA timezone for displayed dates; omitted or invalid values use UTC. */
  timeZone?: string;
  /** Shop branding shown in every email's header and footer. */
  brand: MailerBrandConfig;
}

/** Module options === the mailer config. */
export type ModuleOptions = MailerConfig;
