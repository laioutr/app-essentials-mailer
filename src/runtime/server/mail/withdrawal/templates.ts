import { renderFormEmail, type FormEmailField } from '../template/renderFormEmail';
import { getWithdrawalStrings, type WithdrawalStrings } from './strings';
import type { MailTemplate } from '../template/types';

export interface WithdrawalVars {
  name: string;
  orderReference: string;
  email: string;
  submittedAt: Date;
}

const fields = (vars: WithdrawalVars, s: WithdrawalStrings): FormEmailField[] => [
  { label: s.fieldLabels.name, value: vars.name },
  { label: s.fieldLabels.orderReference, value: vars.orderReference },
  { label: s.fieldLabels.email, value: vars.email },
];

export const renderWithdrawalStoreNotice: MailTemplate<WithdrawalVars> = (ctx, vars) => {
  const s = getWithdrawalStrings(ctx.locale);
  return {
    subject: s.subjectStoreNotice,
    ...renderFormEmail({
      ctx,
      heading: s.storeNotice.heading,
      intro: s.storeNotice.intro,
      formType: s.formType,
      fields: fields(vars, s),
      submittedAt: vars.submittedAt,
    }),
  };
};

export const renderWithdrawalAck: MailTemplate<WithdrawalVars> = (ctx, vars) => {
  const s = getWithdrawalStrings(ctx.locale);
  return {
    subject: s.subjectConsumerAck,
    ...renderFormEmail({
      ctx,
      heading: s.consumerAck.heading,
      intro: s.consumerAck.intro,
      formType: s.formType,
      fields: fields(vars, s),
      submittedAt: vars.submittedAt,
    }),
  };
};
