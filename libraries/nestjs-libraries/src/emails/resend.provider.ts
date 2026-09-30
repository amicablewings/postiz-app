import { Resend } from 'resend';
import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';

const resend = new Resend(process.env.RESEND_API_KEY || 're_132');

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
    const sends = await resend.emails.send({
      from: `${emailFromName} <${emailFromAddress}>`,
      to,
      subject,
      html,
      ...(replyTo && { reply_to: replyTo }),
    });

    // resend v3 returns { data, error } and does not throw
    if (sends?.error) {
      throw new Error(sends.error.message || 'Could not send email');
    }

    return sends;
  }
}
