import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfig } from './config';
import { mailEnabled, sendMail } from './mail';

const { createTransport, send } = vi.hoisted(() => {
  const send = vi.fn();
  return { send, createTransport: vi.fn(() => ({ sendMail: send })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const msg = { to: 'u@example.com', subject: 'Hi', text: 'Body' };

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({ accepted: [msg.to], rejected: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe('mail', () => {
  it('is disabled without SMTP_URL', async () => {
    expect(mailEnabled()).toBe(false);
    await expect(sendMail(msg)).rejects.toThrow('Email is not configured (SMTP_URL)');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends plain text from APP_NAME <MAIL_FROM>, one transport per SMTP_URL', async () => {
    vi.stubEnv('SMTP_URL', 'smtp://a:1025');
    vi.stubEnv('MAIL_FROM', 'bot@example.com');
    resetConfig();
    expect(mailEnabled()).toBe(true);
    await sendMail(msg);
    await sendMail(msg);
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith('smtp://a:1025');
    expect(send).toHaveBeenCalledWith({ from: { name: 'Multiposter', address: 'bot@example.com' }, ...msg });

    vi.unstubAllEnvs();
    vi.stubEnv('SMTP_URL', 'smtps://u:p@b:465');
    resetConfig();
    await sendMail(msg);
    expect(createTransport).toHaveBeenCalledTimes(2);
    expect(createTransport).toHaveBeenLastCalledWith('smtps://u:p@b:465');
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ from: { name: 'Multiposter', address: 'no-reply@localhost' } }));
  });

  it('throws when a recipient is rejected', async () => {
    vi.stubEnv('SMTP_URL', 'smtp://a:1025');
    resetConfig();
    send.mockResolvedValueOnce({ accepted: [], rejected: ['u@example.com'] });
    await expect(sendMail(msg)).rejects.toThrow('Email rejected for u@example.com');
  });
});
