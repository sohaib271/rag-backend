import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis.service.js';

@Injectable()
export class AnswerCacheService {
  private readonly ttlSeconds = 10 * 60;

  constructor(private readonly redis: RedisService) {}

  get(companyId: string, question: string): Promise<string | null> {
    const key = this.createKey(companyId, question);
    return this.redis.client.get(key);
  }

  async set(companyId: string, question: string, answer: string) {
    const key = this.createKey(companyId, question);
    await this.redis.client.set(key, answer, { EX: this.ttlSeconds });
  }

  async clearCompany(companyId: string) {
    for await (const keys of this.redis.client.scanIterator({
      MATCH: `answer-cache:${companyId}:*`,
      COUNT: 100,
    })) {
      if (keys.length > 0) await this.redis.client.unlink(keys);
    }
  }

  private createKey(companyId: string, question: string) {
    return `answer-cache:${companyId}:${normalize(question)}`;
  }
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
