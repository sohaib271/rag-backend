import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASSWORD');
    this.from = config.get<string>('SMTP_FROM', user ?? 'bookings@example.com');
    this.transporter = host ? nodemailer.createTransport({
      host,
      port: config.get<number>('SMTP_PORT', 587),
      secure: config.get<string>('SMTP_SECURE', 'false') === 'true',
      auth: user && pass ? { user, pass } : undefined,
    }) : null;
  }

  send(input: { to: string; subject: string; text: string; html: string }) {
    if (!this.transporter) {
      throw new Error('SMTP_HOST is required to send booking emails.');
    }
    return this.transporter.sendMail({ from: this.from, ...input });
  }
}
