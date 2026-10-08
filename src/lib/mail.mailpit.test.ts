import { afterEach, expect, it, vi } from 'vitest';
import { resetConfig } from './config';
import { sendMail } from './mail';

// real SMTP round trip through Mailpit (docker compose / CI service)
const SMTP = process.env.TEST_SMTP_URL ?? 'smtp://localhost:1025';
const MAILPIT = process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025';

afterEach(() => vi.unstubAllEnvs());

it('delivers through Mailpit', async () => {
  vi.stubEnv('SMTP_URL', SMTP);
  vi.stubEnv('MAIL_FROM', 'sender@example.com');
  resetConfig();
  expect((await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' })).ok).toBe(true);

  await sendMail({ to: 'someone@example.com', subject: 'Mailpit check', text: 'Hello from the test' });

  const { messages } = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  expect(messages).toHaveLength(1);
  const [m] = messages;
  expect(m.To[0].Address).toBe('someone@example.com');
  expect(m.Subject).toBe('Mailpit check');
  expect(m.From).toMatchObject({ Address: 'sender@example.com', Name: 'Multiposter' });
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
  expect(full.Text).toContain('Hello from the test');
});
