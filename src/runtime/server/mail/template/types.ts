export interface FormEmailLink {
  label: string;
  url: string;
}

/** Shared render context, assembled once from config + request locale. Templates pick the
 *  renderer; each renderer owns its layout — so no layout appears here. */
export interface MailRenderContext {
  locale: string;
  timeZone?: string;
  shopName: string;
  shopUrl?: string;
  footerLinks?: FormEmailLink[];
}

/** A template's output: everything a MailMessage needs except addressing. Internal. */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** The template convention, named for authoring convenience. Internal — not exported from index. */
export type MailTemplate<Vars> = (ctx: MailRenderContext, vars: Vars) => RenderedMail;
