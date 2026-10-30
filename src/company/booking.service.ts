import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { Booking, BookingStatus } from '../entities/booking.entity.js';
import {
  BookingFlowState,
  Conversation,
  type BookingDraft,
} from '../entities/conversations.entity.js';
import { Company } from '../entities/company.entity.js';
import { ServiceInfo } from '../entities/service-info.entity.js';
import type { CustomerIntent, IntentEntities } from './genai/intent-detection.js';

export type BookingReply = {
  answer: string;
  bookingId?: string;
};

@Injectable()
export class BookingService {
  private readonly timeZone: string;
  private readonly openingHour: number;
  private readonly closingHour: number;

  constructor(
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(ServiceInfo)
    private readonly services: Repository<ServiceInfo>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.timeZone = config.get('BUSINESS_TIMEZONE', 'Asia/Karachi');
    this.openingHour = Number(config.get('BUSINESS_OPENING_HOUR', 9));
    this.closingHour = Number(config.get('BUSINESS_CLOSING_HOUR', 18));
  }

  async handleIntent(input: {
    conversation: Conversation;
    intent: CustomerIntent;
    entities: IntentEntities;
    customerMessage: string;
  }): Promise<BookingReply> {
    switch (input.intent) {
      case 'book_appointment':
      case 'provide_booking_details':
        return this.collectDetails(
          input.conversation,
          preserveRelativeDate(input.entities, input.customerMessage),
        );
      case 'confirm_booking':
        return this.confirm(input.conversation);
      case 'cancel_booking':
        return this.cancel(input.conversation, input.customerMessage);
      case 'reschedule_booking':
        return this.startReschedule(
          input.conversation,
          input.entities,
          input.customerMessage,
        );
      default:
        throw new BadRequestException('This is not a booking action.');
    }
  }

  private async collectDetails(
    conversation: Conversation,
    entities: IntentEntities,
  ): Promise<BookingReply> {
    const draft: BookingDraft = {
      ...(conversation.bookingDraft ?? {}),
      ...entities,
    };

    if (!draft.serviceName && !draft.serviceId) {
      await this.saveDraft(conversation, BookingFlowState.COLLECTING_DETAILS, draft);
      return { answer: await this.servicePrompt(conversation.companyId) };
    }

    let service = draft.serviceId
      ? await this.services.findOneBy({ id: draft.serviceId, companyId: conversation.companyId })
      : null;
    if (!service && draft.serviceName) {
      const matches = await this.services
        .createQueryBuilder('service')
        .where('service.companyId = :companyId', { companyId: conversation.companyId })
        .andWhere('LOWER(service.name) LIKE :name', { name: `%${draft.serviceName.toLowerCase()}%` })
        .orderBy('service.name', 'ASC')
        .take(2)
        .getMany();
      if (matches.length === 1) service = matches[0];
    }

    if (!service) {
      delete draft.serviceId;
      delete draft.serviceName;
      await this.saveDraft(conversation, BookingFlowState.COLLECTING_DETAILS, draft);
      return {
        answer: `I couldn't find that service. ${await this.servicePrompt(conversation.companyId)}`,
      };
    }

    draft.serviceId = service.id;
    draft.serviceName = service.name;

    console.log("Draft : ",draft)

    if (!draft.date) {
      await this.saveDraft(conversation, BookingFlowState.COLLECTING_DETAILS, draft);
      return { answer: `Which date would you prefer for ${service.name}?` };
    }
    if (!draft.time) {
      await this.saveDraft(conversation, BookingFlowState.COLLECTING_DETAILS, draft);
      return { answer: `What time would you prefer on ${draft.date}?` };
    }

    const startsAt = parseLocalAppointment(
      draft.date,
      draft.time,
      this.timeZone,
    );
    console.log("Starts at : ",startsAt);
    if (!startsAt) {
      delete draft.date;
      delete draft.time;
      await this.saveDraft(conversation, BookingFlowState.COLLECTING_DETAILS, draft);
      return {
        answer: 'I could not understand that date and time. Please use a format like “October 30 at 3:00 PM”.',
      };
    }
    if (startsAt.getTime() <= Date.now()) {
      delete draft.date;
      delete draft.time;
      await this.saveDraft(conversation, BookingFlowState.COLLECTING_DETAILS, draft);
      return { answer: 'That time is in the past. Which future date and time would you prefer?' };
    }

    const endsAt = new Date(startsAt.getTime() + service.avgTime * 60_000);
    const company = await this.companies.findOneByOrFail({ id: conversation.companyId });
    const available = await this.isAvailable(
      company,
      startsAt,
      endsAt,
      draft.rescheduleBookingId,
    );

    if (!available) {
      const alternatives = await this.findAvailableSlots(
        company,
        service,
        draft.date,
        draft.rescheduleBookingId,
      );
      delete draft.time;
      delete draft.startsAt;
      delete draft.endsAt;
      await this.saveDraft(conversation, BookingFlowState.COLLECTING_DETAILS, draft);
      return {
        answer: alternatives.length
          ? `That time is fully booked. Available times on ${draft.date} include ${alternatives.join(', ')}. Which one would you prefer?`
          : `That time is fully booked, and I couldn't find another slot on ${draft.date}. Which other date would you prefer?`,
      };
    }

    draft.startsAt = startsAt.toISOString();
    draft.endsAt = endsAt.toISOString();
    await this.saveDraft(
      conversation,
      BookingFlowState.AWAITING_CONFIRMATION,
      draft,
    );

    const action = draft.rescheduleBookingId ? 'reschedule' : 'book';
    return {
      answer: [
        `Please confirm that you want to ${action} this appointment:`,
        `Service: ${service.name}`,
        `Date: ${formatDateTime(startsAt, this.timeZone, 'date')}`,
        `Time: ${formatDateTime(startsAt, this.timeZone, 'time')}`,
        `Duration: ${service.avgTime} minutes`,
        `Price: $${Number(service.price).toFixed(2)}`,
        'Reply “yes” to confirm.',
      ].join('\n'),
    };
  }

  private async confirm(conversation: Conversation): Promise<BookingReply> {
    if (conversation.bookingFlowState !== BookingFlowState.AWAITING_CONFIRMATION) {
      return { answer: 'There is no appointment waiting for confirmation.' };
    }
    const draft = conversation.bookingDraft ?? {};
    if (!conversation.userId || !draft.serviceId || !draft.startsAt || !draft.endsAt) {
      await this.saveDraft(conversation, BookingFlowState.NONE, {});
      return { answer: 'The booking details were incomplete, so I cleared the draft. Please start again.' };
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const company = await manager.getRepository(Company).findOne({
        where: { id: conversation.companyId },
        lock: { mode: 'pessimistic_write' },
      });
      const service = await manager.getRepository(ServiceInfo).findOneBy({
        id: draft.serviceId!,
        companyId: conversation.companyId,
      });
      if (!company || !service) return { unavailable: true as const };

      const startsAt = new Date(draft.startsAt!);
      const endsAt = new Date(draft.endsAt!);
      const bookingRepository = manager.getRepository(Booking);
      const overlapCount = await this.overlapCount(
        bookingRepository,
        company.id,
        startsAt,
        endsAt,
        draft.rescheduleBookingId,
      );
      if (overlapCount >= company.oneTimeCapacity) {
        return { unavailable: true as const };
      }

      let booking: Booking;
      if (draft.rescheduleBookingId) {
        const existing = await bookingRepository.findOneBy({
          id: draft.rescheduleBookingId,
          companyId: company.id,
          userId: conversation.userId!,
          status: BookingStatus.CONFIRMED,
        });
        if (!existing) return { unavailable: true as const };
        existing.serviceId = service.id;
        existing.startsAt = startsAt;
        existing.endsAt = endsAt;
        existing.priceAtBooking = service.price;
        booking = await bookingRepository.save(existing);
      } else {
        booking = await bookingRepository.save(
          bookingRepository.create({
            companyId: company.id,
            userId: conversation.userId!,
            serviceId: service.id,
            conversationId: conversation.id,
            startsAt,
            endsAt,
            priceAtBooking: service.price,
            status: BookingStatus.CONFIRMED,
          }),
        );
      }

      conversation.bookingFlowState = BookingFlowState.NONE;
      conversation.bookingDraft = {};
      await manager.getRepository(Conversation).save(conversation);
      return { unavailable: false as const, booking, service };
    });

    if (result.unavailable) {
      conversation.bookingFlowState = BookingFlowState.COLLECTING_DETAILS;
      conversation.bookingDraft = { ...draft, time: undefined, startsAt: undefined, endsAt: undefined };
      await this.conversations.save(conversation);
      return { answer: 'That slot was just taken. Please choose another time.' };
    }

    return {
      bookingId: result.booking.id,
      answer: [
        draft.rescheduleBookingId ? 'Your appointment has been rescheduled.' : 'Your appointment is confirmed.',
        `Booking ID: ${result.booking.id}`,
        `Service: ${result.service.name}`,
        `Date: ${formatDateTime(result.booking.startsAt, this.timeZone, 'date')}`,
        `Time: ${formatDateTime(result.booking.startsAt, this.timeZone, 'time')}`,
      ].join('\n'),
    };
  }

  private async cancel(conversation: Conversation, message: string): Promise<BookingReply> {
    if (conversation.bookingFlowState !== BookingFlowState.NONE) {
      await this.saveDraft(conversation, BookingFlowState.NONE, {});
      return { answer: 'I cancelled the appointment request you were preparing.' };
    }

    const requestedId = extractBookingId(message);
    const candidates = requestedId
      ? await this.bookings.find({ where: { id: requestedId, companyId: conversation.companyId, userId: conversation.userId!, status: BookingStatus.CONFIRMED } })
      : await this.bookings.find({
          where: {
            companyId: conversation.companyId,
            userId: conversation.userId!,
            status: BookingStatus.CONFIRMED,
            startsAt: MoreThan(new Date()),
          },
          order: { startsAt: 'ASC' },
          take: 2,
        });

    if (candidates.length === 0) return { answer: 'I could not find an upcoming confirmed appointment to cancel.' };
    if (candidates.length > 1) return { answer: 'You have multiple upcoming appointments. Please provide the booking ID you want to cancel.' };
    candidates[0].status = BookingStatus.CANCELLED;
    await this.bookings.save(candidates[0]);
    return { answer: `Booking ${candidates[0].id} has been cancelled.` };
  }

  private async startReschedule(
    conversation: Conversation,
    entities: IntentEntities,
    message: string,
  ): Promise<BookingReply> {
    const requestedId = extractBookingId(message);
    const candidates = requestedId
      ? await this.bookings.find({ where: { id: requestedId, companyId: conversation.companyId, userId: conversation.userId!, status: BookingStatus.CONFIRMED } })
      : await this.bookings.find({
          where: { companyId: conversation.companyId, userId: conversation.userId!, status: BookingStatus.CONFIRMED, startsAt: MoreThan(new Date()) },
          order: { startsAt: 'ASC' }, take: 2,
        });
    if (candidates.length === 0) return { answer: 'I could not find an upcoming confirmed appointment to reschedule.' };
    if (candidates.length > 1) return { answer: 'You have multiple upcoming appointments. Please provide the booking ID you want to reschedule.' };

    const booking = candidates[0];
    const service = await this.services.findOneByOrFail({ id: booking.serviceId });
    const draft: BookingDraft = {
      serviceId: service.id,
      serviceName: service.name,
      date: entities.date,
      time: entities.time,
      rescheduleBookingId: booking.id,
    };
    await this.saveDraft(conversation, BookingFlowState.COLLECTING_DETAILS, draft);
    return this.collectDetails(conversation, {});
  }

  private async servicePrompt(companyId: string) {
    const services = await this.services.find({ where: { companyId }, order: { name: 'ASC' } });
    if (!services.length) return 'Which service would you like to book?';
    return `Which service would you like? Available services are ${services.map((service) => `${service.name} ($${Number(service.price).toFixed(2)})`).join(', ')}.`;
  }

  private async saveDraft(
    conversation: Conversation,
    state: BookingFlowState,
    draft: BookingDraft,
  ) {
    conversation.bookingFlowState = state;
    conversation.bookingDraft = draft;
    await this.conversations.save(conversation);
  }

  private async isAvailable(
    company: Company,
    startsAt: Date,
    endsAt: Date,
    excludingBookingId?: string,
  ) {
    return (await this.overlapCount(this.bookings, company.id, startsAt, endsAt, excludingBookingId)) < company.oneTimeCapacity;
  }

  private async overlapCount(
    repository: Repository<Booking>,
    companyId: string,
    startsAt: Date,
    endsAt: Date,
    excludingBookingId?: string,
  ) {
    return repository.count({
      where: {
        companyId,
        status: BookingStatus.CONFIRMED,
        startsAt: LessThan(endsAt),
        endsAt: MoreThan(startsAt),
        ...(excludingBookingId ? { id: Not(excludingBookingId) } : {}),
      },
    });
  }

  private async findAvailableSlots(
    company: Company,
    service: ServiceInfo,
    date: string,
    excludingBookingId?: string,
  ) {
    const slots: string[] = [];
    for (let hour = this.openingHour; hour < this.closingHour; hour++) {
      for (const minute of [0, 30]) {
        const displayTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const start = parseLocalAppointment(date, displayTime, this.timeZone);
        if (!start || start.getTime() <= Date.now()) continue;
        const end = new Date(start.getTime() + service.avgTime * 60_000);
        const closing = parseLocalAppointment(date, `${this.closingHour}:00`, this.timeZone);
        if (!closing || end > closing) continue;
        if (await this.isAvailable(company, start, end, excludingBookingId)) {
          slots.push(formatDateTime(start, this.timeZone, 'time'));
          if (slots.length === 3) return slots;
        }
      }
    }
    return slots;
  }
}

function extractBookingId(message: string) {
  return message.match(/\b(?:booking|appointment)\s*(?:id|#)?\s*(\d+)\b/i)?.[1];
}

function preserveRelativeDate(
  entities: IntentEntities,
  customerMessage: string,
): IntentEntities {
  const relativeDate = customerMessage.match(
    /\b(day after tomorrow|today|tomorrow|(?:(?:this|next)\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i,
  )?.[1];

  return relativeDate
    ? { ...entities, date: relativeDate }
    : entities;
}

export function parseLocalAppointment(dateText: string, timeText: string, timeZone: string) {
  const date = parseDateParts(dateText, timeZone);
  const time = parseTimeParts(timeText);
  if (!date || !time) return null;
  return zonedDateTimeToUtc({ ...date, ...time }, timeZone);
}

function parseDateParts(value: string, timeZone: string) {
  const normalized = value.trim().toLowerCase().replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1');
  const today = localDateParts(new Date(), timeZone);
  if (normalized === 'today') return today;
  if (normalized === 'tomorrow') {
    const midday = zonedDateTimeToUtc({ ...today, hour: 12, minute: 0 }, timeZone);
    return localDateParts(new Date(midday.getTime() + 86_400_000), timeZone);
  }
  if (normalized === 'day after tomorrow') {
    const midday = zonedDateTimeToUtc({ ...today, hour: 12, minute: 0 }, timeZone);
    return localDateParts(new Date(midday.getTime() + 2 * 86_400_000), timeZone);
  }

  const weekday = normalized.match(/^(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (weekday) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayAtNoon = zonedDateTimeToUtc({ ...today, hour: 12, minute: 0 }, timeZone);
    const currentIndex = weekdays.indexOf(
      new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(todayAtNoon).toLowerCase(),
    );
    const targetIndex = weekdays.indexOf(weekday[2]);
    let daysAhead = (targetIndex - currentIndex + 7) % 7;
    if (weekday[1] === 'next' && daysAhead === 0) daysAhead = 7;
    return localDateParts(new Date(todayAtNoon.getTime() + daysAhead * 86_400_000), timeZone);
  }

  // Never pass an unrecognised weekday phrase to JavaScript's permissive Date
  // parser. Inputs such as "this Sunday" can otherwise become unrelated dates.
  if (/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(normalized)) {
    return null;
  }

  const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:t.*)?$/);
  if (iso) return validDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const containsYear = /\b\d{4}\b/.test(normalized);
  const parsed = new Date(`${normalized}${containsYear ? '' : ` ${today.year}`} 12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  let result = validDateParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  if (
    result &&
    !containsYear &&
    Date.UTC(result.year, result.month - 1, result.day) < Date.UTC(today.year, today.month - 1, today.day)
  ) {
    result = validDateParts(result.year + 1, result.month, result.day);
  }
  return result;
}

function parseTimeParts(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\./g, '').replace(/^at\s+/, '').replace(/\s+/g, ' ');
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59 || (meridiem && (hour < 1 || hour > 12)) || (!meridiem && hour > 23)) return null;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  return { hour, minute };
}

function validDateParts(year: number, month: number, day: number) {
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function zonedDateTimeToUtc(
  value: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
) {
  let result = new Date(Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute));
  for (let index = 0; index < 2; index++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(result);
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    const desired = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
    result = new Date(result.getTime() + desired - represented);
  }
  return result;
}

function formatDateTime(date: Date, timeZone: string, part: 'date' | 'time') {
  return new Intl.DateTimeFormat('en-US', part === 'date'
    ? { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
    : { timeZone, hour: 'numeric', minute: '2-digit' }
  ).format(date);
}
