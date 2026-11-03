import { Module } from '@nestjs/common';
import { CompanyController } from './company.controller.js';
import { CompanyService } from './company.service.js';
import { Company } from '../entities/company.entity.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentChunk } from '../entities/document-chunk.entity.js';
import { Document } from '../entities/document.entity.js';
import { MalwareService } from '../malware/malware.service.js';
import { ConversationMessage } from '../entities/conversation-message.entity.js';
import { Conversation } from '../entities/conversations.entity.js';
import { DirectAnswer } from '../entities/direct-answer.entity.js';
import { DirectAnswerService } from './direct-answer.service.js';
import { AnswerCacheService } from './redis/exact-cache/answerCache.service.js';
import { RedisService } from './redis/redis.service.js';
import { SemanticCacheService } from './redis/semantic-cache/semanticCache.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ServiceInfo } from '../entities/service-info.entity.js';
import { ServiceInfoService } from './service-info.service.js';
import { Booking } from '../entities/booking.entity.js';
import { BookingService } from './booking.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { User } from '../entities/user.entity.js';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    TypeOrmModule.forFeature([Company, DocumentChunk, Document, Conversation, ConversationMessage, DirectAnswer, ServiceInfo, Booking, User]),
  ],
  controllers: [CompanyController],
  providers: [
    CompanyService,
    DirectAnswerService,
    MalwareService,
    RedisService,
    AnswerCacheService,
    SemanticCacheService,
    ServiceInfoService,
    BookingService,
  ],
})
export class CompanyModule {}
