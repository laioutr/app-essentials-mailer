import srcModule from '../src/module';

export default defineNuxtConfig({
  modules: [
    srcModule,
    '@laioutr-core/frontend-core',
    '@laioutr-core/orchestr',
    '@laioutr-core/devtools',
  ],
  devtools: { enabled: true },
  compatibilityDate: '2025-09-11',
  // Dummy config so the module loads during dev/prepare. Does not send real mail.
  '@laioutr/app-essentials-mailer': {
    transport: { type: 'smtp', host: 'localhost', port: 1025, auth: { user: 'dev', pass: 'dev' } },
    from: 'Dev Shop <noreply@localhost>',
    recipient: 'trader@localhost',
    brand: {
      shopName: 'Dev Shop',
      shopUrl: 'https://dev.localhost',
      footerLinks: [
        { label: 'Imprint', url: 'https://dev.localhost/imprint' },
        { label: 'Privacy', url: 'https://dev.localhost/privacy' },
      ],
    },
  },
});
