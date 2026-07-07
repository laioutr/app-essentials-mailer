import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  return { sendMailMock, createTransportMock: vi.fn(() => ({ sendMail: sendMailMock })) };
});
vi.mock('nodemailer', () => ({
  createTransport: createTransportMock,
  default: { createTransport: createTransportMock },
}));

import { sendMail } from '../src/runtime/server/mail/sendMail';

beforeEach(() => {
  sendMailMock.mockReset();
  createTransportMock.mockClear();
});

describe('sendMail', () => {
  it('resolves the transport from config and sends the message', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'sent-1' });
    const r = await sendMail(
      {
        transport: { type: 'smtp', host: 'h', port: 587, auth: { user: 'u', pass: 'p' } },
        from: 'a@b.com',
        recipient: 'c@d.com',
      },
      { from: 'a@b.com', to: 'c@d.com', subject: 's', html: '<p>h</p>', text: 'h' },
    );
    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ messageId: 'sent-1' });
  });
});
