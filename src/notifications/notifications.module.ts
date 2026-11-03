import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../entities/booking.entity.js';
import { BookingEmailQueueService } from './booking-email-queue.service.js';
import { BookingEmailService } from './booking-email.service.js';
import { EmailService } from './email.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Booking])],
  providers: [EmailService, BookingEmailService, BookingEmailQueueService],
  exports: [BookingEmailQueueService],
})
export class NotificationsModule {}
