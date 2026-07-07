/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { RuntimeConfigModulePrivate, RuntimeConfigModulePublic } from './module';

declare module 'vue' {
  interface GlobalComponents {}
  interface ComponentCustomProperties {}
}

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    ['@laioutr/app-essentials-mailer']: RuntimeConfigModulePublic;
  }
  interface RuntimeConfig {
    ['@laioutr/app-essentials-mailer']: RuntimeConfigModulePrivate;
  }
}

export {};
