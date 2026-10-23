import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client;

  constructor(config: ConfigService) {
    this.client = createClient({
      url: config.get('REDIS_URL', 'redis://localhost:6379'),
    });
    this.client.on('error', (error) => {
      this.logger.error('Redis client error', error);
    });
  }

  async onModuleInit() {
    await this.client.connect();
    this.logger.log('Connected to Redis');
  }

  onModuleDestroy() {
    if (this.client.isOpen) this.client.destroy();
  }
}
