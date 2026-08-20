# Changelog


## v0.1.3

[compare changes](https://github.com/laioutr/app-essentials-mailer/compare/v0.1.2...v0.1.3)

### 🚀 Enhancements

- Configure mailer addressing and the withdrawal ack per action ([59959f1](https://github.com/laioutr/app-essentials-mailer/commit/59959f1))

### 🤖 CI

- Pin pnpm via packageManager and align the workflow with app-essentials-seo ([0a85808](https://github.com/laioutr/app-essentials-mailer/commit/0a85808))

### ❤️ Contributors

- Sebastian Langer <sebastian.langer@laioutr.com>

## v0.1.2

[compare changes](https://github.com/laioutr/app-essentials-mailer/compare/v0.1.1...v0.1.2)

### 🩹 Fixes

- Await withdrawal consumer ack in the request path ([6877fad](https://github.com/laioutr/app-essentials-mailer/commit/6877fad))

### 🏡 Chore

- Publish package publicly ([b4dc030](https://github.com/laioutr/app-essentials-mailer/commit/b4dc030))

### ❤️ Contributors

- Sebastian Langer <sebastian.langer@laioutr.com>

## v0.1.1


### 🚀 Enhancements

- Maizzle precompile pipeline for email templates ([84b3b33](https://github.com/laioutr/app-essentials-mailer/commit/84b3b33))
- Pure shell-interpolation renderer + key-addressed shell lookup ([189b5e2](https://github.com/laioutr/app-essentials-mailer/commit/189b5e2))
- Mail transport seam with nodemailer SMTP adapter and resolver ([f034817](https://github.com/laioutr/app-essentials-mailer/commit/f034817))
- Withdrawal orchestration with p-retry (pre-delivery errors only) ([f59ba1c](https://github.com/laioutr/app-essentials-mailer/commit/f59ba1c))
- Server-only /server API (transport + renderer + sendMail) ([97abaef](https://github.com/laioutr/app-essentials-mailer/commit/97abaef))
- Register WithdrawalAction handler; bump canonical-types peer floor ([d1433b3](https://github.com/laioutr/app-essentials-mailer/commit/d1433b3))
- Brand shop header + footer links; rewrite email template on Maizzle + Tailwind ([fb20773](https://github.com/laioutr/app-essentials-mailer/commit/fb20773))
- Centralize email locale and timezone resolution ([435206b](https://github.com/laioutr/app-essentials-mailer/commit/435206b))
- Localize email metadata and display timezone ([64fba66](https://github.com/laioutr/app-essentials-mailer/commit/64fba66))
- Configure email display timezone ([6b3df13](https://github.com/laioutr/app-essentials-mailer/commit/6b3df13))
- Add app metadata and logo ([8a3c844](https://github.com/laioutr/app-essentials-mailer/commit/8a3c844))
- Add resilient sendMail delivery primitive with per-attempt timeout ([bffdfd9](https://github.com/laioutr/app-essentials-mailer/commit/bffdfd9))
- Bound SMTP connection-phase timeouts below the per-attempt wrapper ([5e9e401](https://github.com/laioutr/app-essentials-mailer/commit/5e9e401))
- Add withdrawal mail templates ([0a34155](https://github.com/laioutr/app-essentials-mailer/commit/0a34155))
- Add auto-imported useMailer composable ([1f9568e](https://github.com/laioutr/app-essentials-mailer/commit/1f9568e))

### 💅 Refactors

- **templating:** Fill compiled shells with Handlebars at runtime ([19d4fc4](https://github.com/laioutr/app-essentials-mailer/commit/19d4fc4))
- Rename email shell to layout and give renderFormEmail its layout + ctx ([f14a982](https://github.com/laioutr/app-essentials-mailer/commit/f14a982))
- Dissolve handleWithdrawal into the action via useMailer + templates ([1401283](https://github.com/laioutr/app-essentials-mailer/commit/1401283))

### 📖 Documentation

- README + extensibility notes; lint clean ([543b65b](https://github.com/laioutr/app-essentials-mailer/commit/543b65b))
- Design localized email metadata and timezone config ([6147c33](https://github.com/laioutr/app-essentials-mailer/commit/6147c33))
- Document useMailer for in-module sends ([0ac4837](https://github.com/laioutr/app-essentials-mailer/commit/0ac4837))

### 🏡 Chore

- Scaffold essentials-mailer app with identity, private config, dev harness ([c47aad9](https://github.com/laioutr/app-essentials-mailer/commit/c47aad9))

### ❤️ Contributors

- Sebastian Langer <sebastian.langer@laioutr.com>

