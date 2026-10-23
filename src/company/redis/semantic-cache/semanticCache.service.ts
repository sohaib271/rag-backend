import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SCHEMA_FIELD_TYPE,
  SCHEMA_VECTOR_FIELD_ALGORITHM,
} from 'redis';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis.service.js';

type SemanticCacheEntry = {
  companyId: string;
  question: string;
  answer: string;
  embedding: number[];
  chunkIds: string[];
};

@Injectable()
export class SemanticCacheService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SemanticCacheService.name);
  private readonly indexName = 'semantic-answer-cache-index';
  private readonly keyPrefix = 'semantic-answer:';
  private readonly ttlSeconds = 10 * 60;
  private readonly minimumSimilarity: number;
  private available = false;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.minimumSimilarity = Number(
      config.get('SEMANTIC_CACHE_MIN_SIMILARITY', '0.95'),
    );
  }

  async onApplicationBootstrap() {
    try {
      await this.redis.client.ft.info(this.indexName);
      this.available = true;
    } catch (error) {
      try {
        await this.redis.client.ft.create(
          this.indexName,
          {
            companyId: { type: SCHEMA_FIELD_TYPE.TAG },
            embedding: {
              type: SCHEMA_FIELD_TYPE.VECTOR,
              ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.HNSW,
              TYPE: 'FLOAT32',
              DIM: 768,
              DISTANCE_METRIC: 'COSINE',
            },
          },
          { ON: 'HASH', PREFIX: this.keyPrefix },
        );
        this.available = true;
        this.logger.log('Created semantic cache vector index');
      } catch (createError) {
        this.logger.warn(
          `Semantic cache disabled: ${createError instanceof Error ? createError.message : String(createError)}`,
        );
      }
    }
  }

  async findSimilar(companyId: string, embedding: number[]) {
    if (!this.available) return null;

    const result = await this.redis.client.ft.search(
      this.indexName,
      `(@companyId:{${companyId}})=>[KNN 1 @embedding $vector AS distance]`,
      {
        PARAMS: { vector: toVectorBuffer(embedding) },
        RETURN: ['answer', 'question', 'chunkIds', 'distance'],
        DIALECT: 2,
      },
    );

    const match = result.documents[0];
    if (!match) return null;

    const distance = Number(match.value.distance);
    const similarity = 1 - distance;
    console.log("Similarity : ",similarity);
    if (similarity < this.minimumSimilarity) return null;

    return {
      answer: String(match.value.answer),
      question: String(match.value.question),
      chunkIds: JSON.parse(String(match.value.chunkIds)) as string[],
      similarity,
    };
  }

  async set(entry: SemanticCacheEntry) {
    if (!this.available) return;

    const key = `${this.keyPrefix}${entry.companyId}:${randomUUID()}`;
    await this.redis.client.hSet(key, {
      companyId: entry.companyId,
      question: entry.question,
      answer: entry.answer,
      chunkIds: JSON.stringify(entry.chunkIds),
      embedding: toVectorBuffer(entry.embedding),
    });
    await this.redis.client.expire(key, this.ttlSeconds);
  }

  async clearCompany(companyId: string) {
    for await (const keys of this.redis.client.scanIterator({
      MATCH: `${this.keyPrefix}${companyId}:*`,
      COUNT: 100,
    })) {
      if (keys.length > 0) await this.redis.client.unlink(keys);
    }
  }
}

function toVectorBuffer(embedding: number[]) {
  return Buffer.from(new Float32Array(embedding).buffer);
}
