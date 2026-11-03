import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../entities/booking.entity.js';
import { EmailService } from './email.service.js';
import type { BookingEmailJob } from './booking-email.types.js';

@Injectable()
export class BookingEmailService {
  private readonly timeZone: string;

  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.timeZone = config.get('BUSINESS_TIMEZONE', 'Asia/Karachi');
  }

  async send(job: BookingEmailJob) {
    const booking = await this.bookings.findOne({
      where: { id: job.bookingId },
      relations: { user: true, company: { owner: true }, service: true },
    });
    if (!booking) throw new Error(`Booking ${job.bookingId} was not found.`);

    const admin = job.recipient === 'admin' ? booking.company.owner : null;
    if (job.recipient === 'admin' && !admin) {
      throw new Error('No admin user exists to receive booking notifications.');
    }

    const date = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(booking.startsAt);
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(booking.startsAt);
    const action = job.event === 'rescheduled' ? 'rescheduled' : 'confirmed';
    const title = job.recipient === 'customer'
      ? `Your appointment is ${action}`
      : `Appointment ${action}: ${booking.user.name}`;
    const intro = job.recipient === 'customer'
      ? `Hello ${booking.user.name}, your appointment with ${booking.company.name} has been ${action}.`
      : `${booking.user.name} (${booking.user.email}) has ${action} an appointment with ${booking.company.name}.`;
    const details = [
      `Booking ID: ${booking.id}`,
      `Service: ${booking.service.name}`,
      `Date: ${date}`,
      `Time: ${time}`,
      `Duration: ${booking.service.avgTime} minutes`,
      `Price: ${new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: booking.currencyAtBooking,
      }).format(Number(booking.priceAtBooking))}`,
    ];

    await this.email.send({
      to: job.recipient === 'customer' ? booking.user.email : admin!.email,
      subject: title,
      text: [intro, '', ...details].join('\n'),
      html: `<p>${escapeHtml(intro)}</p><ul>${details
        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
        .join('')}</ul>`,
    });
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character]!);
}
