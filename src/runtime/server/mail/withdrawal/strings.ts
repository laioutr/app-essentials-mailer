export interface WithdrawalStrings {
  formType: string;
  subjectStoreNotice: string;
  subjectConsumerAck: string;
  storeNotice: { heading: string; intro: string };
  consumerAck: { heading: string; intro: string };
  fieldLabels: { name: string; orderReference: string; email: string };
  errors: { deliveryFailed: string };
}

const STRINGS: Record<'de' | 'en', WithdrawalStrings> = {
  de: {
    formType: 'Widerruf',
    subjectStoreNotice: 'Neuer Widerruf eingegangen',
    subjectConsumerAck: 'Eingangsbestätigung Ihres Widerrufs',
    storeNotice: {
      heading: 'Neuer Widerruf',
      intro:
        'Über das Widerrufsformular ist ein neuer Widerruf eingegangen. Die Angaben des Verbrauchers finden Sie unten.',
    },
    consumerAck: {
      heading: 'Eingangsbestätigung Ihres Widerrufs',
      intro:
        'Wir bestätigen den Eingang Ihres Widerrufs mit den unten aufgeführten Angaben. Diese Bestätigung dient als Nachweis auf einem dauerhaften Datenträger.',
    },
    fieldLabels: { name: 'Name', orderReference: 'Bestellnummer', email: 'E-Mail-Adresse' },
    errors: {
      deliveryFailed:
        'Ihr Widerruf konnte derzeit nicht übermittelt werden. Bitte versuchen Sie es später erneut.',
    },
  },
  en: {
    formType: 'Withdrawal',
    subjectStoreNotice: 'New withdrawal received',
    subjectConsumerAck: 'Confirmation of your withdrawal',
    storeNotice: {
      heading: 'New withdrawal',
      intro:
        'A new withdrawal has been submitted through the withdrawal form. The consumer’s details are listed below.',
    },
    consumerAck: {
      heading: 'Confirmation of your withdrawal',
      intro:
        'We confirm receipt of your withdrawal with the details listed below. This confirmation serves as evidence on a durable medium.',
    },
    fieldLabels: { name: 'Name', orderReference: 'Order reference', email: 'Email address' },
    errors: {
      deliveryFailed:
        'Your withdrawal could not be submitted at this time. Please try again later.',
    },
  },
};

/** Localized withdrawal copy, keyed by the language part of the locale, English fallback. */
export function getWithdrawalStrings(locale: string): WithdrawalStrings {
  const lang = locale.split('-')[0].toLowerCase();
  return STRINGS[lang as 'de' | 'en'] ?? STRINGS.en;
}
