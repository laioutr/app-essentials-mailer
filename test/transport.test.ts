import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  return { sendMailMock, createTransportMock: vi.fn(() => ({ sendMail: sendMailMock })) };
});
vi.mock('nodemailer', () => ({
  createTransport: createTransportMock,
  default: { createTransport: createTransportMock },
}));

import { createSmtpTransport } from '../src/runtime/server/mail/transport/smtp';
import { resolveTransport } from '../src/runtime/server/mail/transport/resolveTransport';

const smtp = {
  type: 'smtp' as const,
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  auth: { user: 'u', pass: 'p' },
};
const message = {
  from: 'a@b.com',
  to: 'c@d.com',
  replyTo: 'e@f.com',
  subject: 'S',
  html: '<p>h</p>',
  text: 'h',
};

beforeEach(() => {
  sendMailMock.mockReset();
  createTransportMock.mockClear();
});

describe('createSmtpTransport', () => {
  it('creates a nodemailer transport from the smtp config', () => {
    createSmtpTransport(smtp);
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
    });
  });

  it('maps MailMessage onto sendMail and returns the messageId', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc' });
    const r = await createSmtpTransport(smtp).send(message);
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'a@b.com',
      to: 'c@d.com',
      replyTo: 'e@f.com',
      subject: 'S',
      text: 'h',
      html: '<p>h</p>',
    });
    expect(r).toEqual({ messageId: 'abc' });
  });

  it('propagates a sendMail rejection', async () => {
    sendMailMock.mockRejectedValue(new Error('smtp down'));
    await expect(createSmtpTransport(smtp).send(message)).rejects.toThrow('smtp down');
  });
});

describe('resolveTransport', () => {
  it('returns an smtp transport for type "smtp"', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'x' });
    await resolveTransport({ transport: smtp, from: 'a@b.com', recipient: 'c@d.com' }).send(message);
    expect(createTransportMock).toHaveBeenCalledTimes(1);
  });

  it('throws for an unsupported transport type', () => {
    const bad = { transport: { type: 'pigeon' }, from: 'a', recipient: 'b' } as never;
    expect(() => resolveTransport(bad)).toThrow(/Unsupported mail transport type/);
  });
});
