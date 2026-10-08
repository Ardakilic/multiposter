import nodemailer, { type Transporter } from 'nodemailer';
import { getConfig } from './config';

let transport: { url: string; mailer: Transporter } | undefined;

/** Email features (verification, password reset) are on iff SMTP_URL is set. */
export function mailEnabled(): boolean {
  return !!getConfig().SMTP_URL;
}

/** Plain-text mail from `APP_NAME <MAIL_FROM>`; throws when disabled, on transport errors, or if any recipient is rejected. */
export async function sendMail(msg: { to: string; subject: string; text: string }): Promise<void> {
  const { SMTP_URL, APP_NAME, MAIL_FROM } = getConfig();
  if (!SMTP_URL) throw new Error('Email is not configured (SMTP_URL)');
  if (transport?.url !== SMTP_URL) transport = { url: SMTP_URL, mailer: nodemailer.createTransport(SMTP_URL) };
  const { rejected } = await transport.mailer.sendMail({
    from: { name: APP_NAME, address: MAIL_FROM },
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
  });
  if (rejected?.length) throw new Error(`Email rejected for ${rejected.join(', ')}`);
}
