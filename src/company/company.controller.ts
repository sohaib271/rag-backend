import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { readFile } from 'node:fs/promises';
import { CompanyDto } from './dto/company.dto.js';
import { CompanyService } from './company.service.js';
import type { Documentdata } from './dto/document-chunk.dto.js';
import { UserQuestionDto } from './dto/user-question.dto.js';
import { DirectAnswerService } from './direct-answer.service.js';
import type { DirectAnswerInput, DirectAnswerUpdate } from './direct-answer.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { Roles, RolesGuard } from '../auth/roles.guard.js';
import { UserRole } from '../entities/user.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ServiceInfoService } from './service-info.service.js';
import type { ServiceInfoInput } from './service-info.service.js';

const content = await readFile(
  './test-data/ghani-branding-retrieval-evaluation.json',
  'utf8',
);
const cases = JSON.parse(content) as any;

@Controller('company')
@UseGuards(AuthGuard, RolesGuard)
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly directAnswers: DirectAnswerService,
    private readonly serviceInfo: ServiceInfoService,
  ) {}

  @Get()
  listCompanies(@Req() request: AuthenticatedRequest) {
    return this.companyService.listCompanies(request.user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  createCompany(@Body() dto: CompanyDto, @Req() request: AuthenticatedRequest) {
    return this.companyService.createCompany(dto.name, request.user.id, dto.oneTimeCapacity, dto.currency);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  updateCompany(@Param('id') id: string, @Body() dto: Partial<CompanyDto>, @Req() request: AuthenticatedRequest) {
    return this.companyService.updateCompany(id, dto, request.user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  deleteCompany(@Param('id') id: string, @Req() request: AuthenticatedRequest) { return this.companyService.deleteCompany(id, request.user.id); }

  @Post('data')
  @Roles(UserRole.ADMIN)
  enterCompanyData(@Body() dto: Documentdata, @Req() request: AuthenticatedRequest) {
    return this.companyService.enterCompanyData(dto, request.user.id);
  }
  @Post('data/upload')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadCompanyData(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { companyId: string; title: string; status?: Documentdata['status'] },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.companyService.enterCompanyFileData(file, body, request.user.id);
  }

  @Post('question')
  userQuestion(@Body() dto: UserQuestionDto, @Req() request: AuthenticatedRequest) {
    return this.companyService.userQuestion(dto.companyId, dto.query, dto.conversationId, request.user.id);
  }

  @Get(':companyId/conversations')
  listConversations(
    @Param('companyId') companyId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.companyService.listConversations(companyId, request.user.id);
  }

  @Get(':companyId/conversations/:conversationId/messages')
  conversationMessages(
    @Param('companyId') companyId: string,
    @Param('conversationId') conversationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.companyService.conversationMessages(
      companyId,
      conversationId,
      request.user.id,
    );
  }

  @Get('direct-answers')
  @Roles(UserRole.ADMIN)
  async listDirectAnswers(@Query('companyId') companyId: string, @Req() request: AuthenticatedRequest) {
    await this.companyService.assertCompanyOwner(companyId, request.user.id);
    return this.directAnswers.list(companyId);
  }

  @Get('direct-answers/suggestions')
  directAnswerSuggestions(@Query('companyId') companyId: string) {
    return this.directAnswers.suggestions(companyId);
  }

  @Post('direct-answers')
  @Roles(UserRole.ADMIN)
  async createDirectAnswer(@Body() input: DirectAnswerInput, @Req() request: AuthenticatedRequest) {
    await this.companyService.assertCompanyOwner(input.companyId, request.user.id);
    return this.directAnswers.create(input);
  }

  @Patch('direct-answers/:id')
  @Roles(UserRole.ADMIN)
  async updateDirectAnswer(@Param('id') id: string, @Body() input: DirectAnswerUpdate, @Req() request: AuthenticatedRequest) {
    await this.companyService.assertCompanyOwner(await this.directAnswers.companyIdForAnswer(id), request.user.id);
    return this.directAnswers.update(id, input);
  }

  @Delete('direct-answers/:id')
  @Roles(UserRole.ADMIN)
  async deleteDirectAnswer(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.companyService.assertCompanyOwner(await this.directAnswers.companyIdForAnswer(id), request.user.id);
    return this.directAnswers.remove(id);
  }

  @Get('evaluate-retrieval')
  @Roles(UserRole.ADMIN)
  evaluateRetrieval() {
    return this.companyService.evaluateRetrieval(cases);
  }

  @Get(':companyId/services')
  listServices(@Param('companyId') companyId: string) { return this.serviceInfo.list(companyId); }

  @Post(':companyId/services')
  @Roles(UserRole.ADMIN)
  async createService(@Param('companyId') companyId: string, @Body() input: Omit<ServiceInfoInput, 'companyId'>, @Req() request: AuthenticatedRequest) {
    await this.companyService.assertCompanyOwner(companyId, request.user.id);
    return this.serviceInfo.create({ companyId, ...input });
  }

  @Patch('services/:id')
  @Roles(UserRole.ADMIN)
  async updateService(@Param('id') id: string, @Body() input: Partial<Omit<ServiceInfoInput, 'companyId'>>, @Req() request: AuthenticatedRequest) {
    await this.companyService.assertCompanyOwner(await this.serviceInfo.companyIdForService(id), request.user.id);
    return this.serviceInfo.update(id, input);
  }

  @Delete('services/:id')
  @Roles(UserRole.ADMIN)
  async deleteService(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.companyService.assertCompanyOwner(await this.serviceInfo.companyIdForService(id), request.user.id);
    return this.serviceInfo.remove(id);
  }
}
