import { Module } from '@nestjs/common';
import { CompanyController } from './company.controller.js';
import { CompanyService } from './company.service.js';
import { Company } from '../entities/company.entity.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentChunk } from '../entities/document-chunk.entity.js';
import { Document } from '../entities/document.entity.js';
import { MalwareService } from '../malware/malware.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company,DocumentChunk,Document]), // Import the Company entity for TypeORM
  ],
  controllers: [CompanyController],
  providers: [CompanyService, MalwareService]
})
export class CompanyModule {}
