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
import { AnswerCacheService } from './cache/answerCache.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, DocumentChunk, Document, Conversation, ConversationMessage, DirectAnswer]),
  ],
  controllers: [CompanyController],
  providers: [CompanyService, DirectAnswerService, MalwareService,AnswerCacheService]
})
export class CompanyModule {}
