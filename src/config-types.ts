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

/** Addressing every action shares. An action block overrides only what differs. */
export interface MailAddressingConfig {
  /** Sender address; may be "Display Name <addr>" form. Defaults to the top-level `from`. */
  from?: string;
  /** Address that receives this action's store notice. Defaults to the top-level `recipient`. */
  recipient?: string;
  /** When not false, the store-notice reply-to is the consumer's email. */
  replyToConsumer?: boolean;
}

/** Per-action settings for the withdrawal (Widerruf) flow. */
export interface WithdrawalActionConfig extends MailAddressingConfig {
  /** When not false (default true), the consumer receives the acknowledgement
   *  (Eingangsbestätigung). Read the § 356 Abs. 1 BGB note in the README before disabling. */
  consumerAck?: boolean;
}

/** One block per action this package ships; each action owns its own shape. */
export interface MailerActionsConfig {
  withdrawal?: WithdrawalActionConfig;
}

/** The private config stored in runtimeConfig[name]. Not validated (by design). */
export interface MailerConfig {
  transport: TransportConfig;
  /** Default sender address; may be "Display Name <addr>" form. An action block may override it. */
  from: string;
  /** Default address that receives store notices. An action block may override it. */
  recipient: string;
  /** When not false (default true), the store-notice reply-to is the consumer's email. */
  replyToConsumer?: boolean;
  /** IANA timezone for displayed dates; omitted or invalid values use UTC. */
  timeZone?: string;
  /** Shop branding shown in every email's header and footer. */
  brand: MailerBrandConfig;
  /** Per-action overrides. Everything inside is optional; omitting it keeps the global defaults. */
  actions?: MailerActionsConfig;
}

/** Module options === the mailer config. */
export type ModuleOptions = MailerConfig;
