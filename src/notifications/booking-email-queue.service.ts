import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker, type ConnectionOptions } from 'bullmq';
import { BookingEmailService } from './booking-email.service.js';
import {
  BOOKING_EMAIL_QUEUE,
  type BookingEmailEvent,
  type BookingEmailJob,
} from './booking-email.types.js';

@Injectable()
export class BookingEmailQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingEmailQueueService.name);
  private readonly connection: ConnectionOptions;
  private queue!: Queue<BookingEmailJob>;
  private worker!: Worker<BookingEmailJob>;

  constructor(
    config: ConfigService,
    private readonly bookingEmails: BookingEmailService,
  ) {
    this.connection = redisConnection(
      config.get('REDIS_URL', 'redis://localhost:6379'),
    );
  }

  onModuleInit() {
    this.queue = new Queue<BookingEmailJob>(BOOKING_EMAIL_QUEUE, {
      connection: this.connection,
    });
    this.worker = new Worker<BookingEmailJob>(
      BOOKING_EMAIL_QUEUE,
      (job) => this.bookingEmails.send(job.data),
      { connection: this.connection, concurrency: 5 },
    );
    this.worker.on('completed', (job) =>
      this.logger.log(`Sent ${job.data.recipient} email for booking ${job.data.bookingId}`),
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(
        `Booking email job ${job?.id ?? 'unknown'} failed: ${error.message}`,
      ),
    );
  }

  async enqueue(bookingId: string, event: BookingEmailEvent) {
    const options = {
      attempts: 5,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    };
    await this.queue.addBulk([
      {
        name: 'customer-booking-confirmation',
        data: { bookingId, recipient: 'customer', event },
        opts: options,
      },
      {
        name: 'admin-new-booking',
        data: { bookingId, recipient: 'admin', event },
        opts: options,
      },
    ]);
  }

  async onModuleDestroy() {
    await Promise.all([this.worker?.close(), this.queue?.close()]);
  }
}

function redisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
