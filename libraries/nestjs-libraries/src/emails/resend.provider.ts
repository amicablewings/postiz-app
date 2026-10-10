import { Resend } from 'resend';
import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';

export class ResendProvider implements EmailInterface {
  name = 'resend';
  validateEnvKeys = ['RESEND_API_KEY'];
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    emailFromName: string,
    emailFromAddress: string,
    replyTo?: string
  ) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set');
    }

    const resend = new Resend(apiKey);
    const sends = await resend.emails.send({
      from: `${emailFromName} <${emailFromAddress}>`,
      to,
      subject,
      html,
      ...(replyTo && { reply_to: replyTo }),
    });

    // The SDK returns API errors (like 429 rate limits) instead of throwing,
    // throw so sendEmailSync retries the send
    if (sends?.error) {
      throw new Error(`${sends.error.name}: ${sends.error.message}`);
    }

    return sends;
  }
}
