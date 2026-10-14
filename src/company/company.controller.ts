import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { readFile } from 'node:fs/promises';
import { CompanyDto } from './dto/company.dto.js';
import { CompanyService } from './company.service.js';
import type { Documentdata } from './dto/document-chunk.dto.js';
import { UserQuestionDto } from './dto/user-question.dto.js';

const content = await readFile(
  './test-data/ghani-branding-retrieval-evaluation.json',
  'utf8',
);
const cases = JSON.parse(content) as any;

@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  listCompanies() {
    return this.companyService.listCompanies();
  }

  @Post()
  createCompany(@Body() dto: CompanyDto) {
    return this.companyService.createCompany(dto.name);
  }

  @Post('data')
  enterCompanyData(@Body() dto: Documentdata) {
    return this.companyService.enterCompanyData(dto);
  }
  @Post('data/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadCompanyData(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { companyId: string; title: string; status?: Documentdata['status'] },
  ) {
    return this.companyService.enterCompanyFileData(file, body);
  }

  @Post('question')
  userQuestion(@Body() dto: UserQuestionDto) {
    return this.companyService.userQuestion(dto.companyId, dto.query,dto.conversationId);
  }

  @Get('evaluate-retrieval')
  evaluateRetrieval() {
    return this.companyService.evaluateRetrieval(cases);
  }
}
