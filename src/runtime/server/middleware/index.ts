import { defineOrchestr } from '#imports';
import { name } from '../../../../package.json';

/** App-scoped orchestr builder; every essentials-mailer action carries this app meta. */
export const defineEssentialsMailer = defineOrchestr.meta({
  app: name,
  label: 'Essentials Mailer',
  logoUrl: '/app-essentials-mailer/logo.png',
});
export const defineEssentialsMailerAction = defineEssentialsMailer.actionHandler;
