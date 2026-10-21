import { Injectable } from "@nestjs/common";

type CachedAnswer = {
  answer: string;
  expiresAt: number;
};

@Injectable()
export class AnswerCacheService {
  private readonly cache = new Map<string, CachedAnswer>();
  private readonly ttl = 10 * 60 * 1000; // 10 minutes

  get(companyId: string, question: string): string | null {
    const key = this.createKey(companyId, question);
    const cached = this.cache.get(key);

    if (!cached) return null;

    if (cached.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return cached.answer;
  }

  set(companyId: string, question: string, answer: string) {
    const key = this.createKey(companyId, question);

    this.cache.set(key, {
      answer,
      expiresAt: Date.now() + this.ttl,
    });
  }

  clearCompany(companyId: string) {
    const prefix = `${companyId}:`;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  private createKey(companyId: string, question: string) {
    return `${companyId}:${normalize(question)}`;
  }
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}