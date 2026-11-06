/* eslint-disable @typescript-eslint/no-empty-object-type */
import { addServerImportsDir, createResolver, defineNuxtModule, installModule } from '@nuxt/kit';
import { defu } from 'defu';
import { DEFAULT_ENVIRONMENT_NAME } from './runtime/server/mail/channels';
import { registerLaioutrApp } from '@laioutr-core/kit';
import type { MailerConfig, ModuleOptions } from './config-types';
import { name, version } from '../package.json';

export type { ModuleOptions };

/** runtimeConfig.public — intentionally empty; secrets stay private. */
export interface RuntimeConfigModulePublic {}
/** runtimeConfig[name] — the mailer config. */
export interface RuntimeConfigModulePrivate extends MailerConfig {}

export default defineNuxtModule<ModuleOptions>({
  meta: { name, version, configKey: name },
  defaults: {},
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);
    const resolveRuntimeModule = (path: string) => resolve('./runtime', path);

    nuxt.options.build.transpile.push(resolve('./runtime'));

    addServerImportsDir(resolveRuntimeModule('server/utils'));

    // The rc is read here because frontend-core does not hand its environment name to the server runtime; the Cockpit's
    // Email channel answers per environment.
     
    const environmentName = (nuxt.options as any).laioutr?.laioutrrc?.laioutr?.environmentName ?? DEFAULT_ENVIRONMENT_NAME;

    // PRIVATE-only. No validation (by design). Never copied to runtimeConfig.public.
    nuxt.options.runtimeConfig[name] = defu(nuxt.options.runtimeConfig[name] as Parameters<typeof defu>[0], options, {
      environmentName,
    });

    // Serve the picker logo (and any future app assets).
    nuxt.options.nitro.publicAssets ??= [];
    nuxt.options.nitro.publicAssets.push({
      dir: resolveRuntimeModule('./app/public'),
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    await registerLaioutrApp({
      name,
      version,
      orchestrDirs: [resolveRuntimeModule('server/orchestr')],
    });

    if (nuxt.options._prepare) {
      await installModule('@laioutr-core/frontend-core');
      await installModule('@laioutr-core/orchestr');
    }
  },
});
