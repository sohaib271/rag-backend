import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { Company } from '../entities/company.entity.js';
import { InjectRepository } from '@nestjs/typeorm';
import { Document } from '../entities/document.entity.js';
import { DocumentChunk } from '../entities/document-chunk.entity.js';
import { Documentdata } from './dto/document-chunk.dto.js';
import { getEmbeddings, getQueryEmbedding } from './genai/embedding.js';
import { getResponseFromGemini } from './genai/response.js';
import { PDFParse } from 'pdf-parse';
import { MalwareService } from '../malware/malware.service.js';
import mammoth from 'mammoth';
import { inspectExtractedText } from './genai/inspectText.js';
import {
  BookingFlowState,
  Conversation,
} from '../entities/conversations.entity.js';
import { ConversationMessage } from '../entities/conversation-message.entity.js';
import { classifyQuestion } from './genai/classification.js';
import { DirectAnswerService } from './direct-answer.service.js';
import { AnswerCacheService } from './redis/exact-cache/answerCache.service.js';
import { SemanticCacheService } from './redis/semantic-cache/semanticCache.service.js';
import {
  detectCustomerIntent,
} from './genai/intent-detection.js';
import { BookingService } from './booking.service.js';

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  constructor(
    private readonly malwareService: MalwareService,
    private readonly directAnswers: DirectAnswerService,
    @InjectRepository(Company)
    private readonly companyTable: Repository<Company>,
    @InjectRepository(Document)
    private readonly documentTable: Repository<Document>,
    @InjectRepository(DocumentChunk)
    private readonly chunkTable: Repository<DocumentChunk>,
    @InjectRepository(Conversation)
    private readonly conversationTable: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly conversationMessageTable: Repository<ConversationMessage>,
    private readonly answerCache: AnswerCacheService,
    private readonly semanticCache: SemanticCacheService,
    private readonly bookingService: BookingService,
  ) {}

  async createCompany(name: string, oneTimeCapacity = 1) {
    const cleanName = name?.trim();
    const capacity = Number(oneTimeCapacity);
    if (!cleanName) throw new BadRequestException('Company name is required.');
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new BadRequestException(
        'One-time capacity must be a positive whole number.',
      );
    const company = this.companyTable.create({
      name: cleanName,
      oneTimeCapacity: capacity,
    });
    return this.companyTable.save(company);
  }

  async updateCompany(
    id: string,
    input: { name?: string; oneTimeCapacity?: number },
  ) {
    const company = await this.companyTable.findOneBy({ id });
    if (!company) throw new NotFoundException('Company not found.');
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Company name is required.');
      company.name = name;
    }
    if (input.oneTimeCapacity !== undefined) {
      const capacity = Number(input.oneTimeCapacity);
      if (!Number.isInteger(capacity) || capacity < 1)
        throw new BadRequestException(
          'One-time capacity must be a positive whole number.',
        );
      company.oneTimeCapacity = capacity;
    }
    return this.companyTable.save(company);
  }

  async deleteCompany(id: string) {
    const result = await this.companyTable.delete(id);
    if (!result.affected) throw new NotFoundException('Company not found.');
    return { deleted: true };
  }

  async listCompanies() {
    const [companies, documentCounts] = await Promise.all([
      this.companyTable.find({ order: { createdAt: 'DESC' } }),
      this.documentTable
        .createQueryBuilder('document')
        .select('document.companyId', 'companyId')
        .addSelect('COUNT(document.id)', 'documentCount')
        .groupBy('document.companyId')
        .getRawMany<{ companyId: string; documentCount: string }>(),
    ]);
    const counts = new Map(
      documentCounts.map(({ companyId, documentCount }) => [
        companyId,
        Number(documentCount),
      ]),
    );

    return companies.map((company) => ({
      id: company.id,
      name: company.name,
      oneTimeCapacity: company.oneTimeCapacity,
      createdAt: company.createdAt,
      documentCount: counts.get(company.id) ?? 0,
    }));
  }
  async enterCompanyData(dto: Documentdata) {
    const chunks = this.createChunks(dto.text);
    const embeddings = await getEmbeddings(chunks.map((content) => content));

    const document = await this.documentTable.save(
      this.documentTable.create({
        companyId: dto.companyId,
        title: dto.title.trim(),
        sourceType: dto.sourceType ?? 'manual',
        status: dto.status ?? 'published',
      }),
    );
    const documentChunks = chunks.map((content, chunkIndex) =>
      this.chunkTable.create({
        companyId: dto.companyId,
        documentId: document.id,
        chunkIndex,
        content,
        embedding: embeddings[chunkIndex].values,
      }),
    );

    await this.chunkTable.save(documentChunks);

    await Promise.all([
      this.answerCache.clearCompany(dto.companyId),
      this.semanticCache.clearCompany(dto.companyId),
    ]);

    return { document, chunksCreated: documentChunks.length };
  }

  async enterCompanyFileData(
    file: Express.Multer.File,
    metadata: {
      companyId: string;
      title: string;
      status?: Documentdata['status'];
    },
  ) {
    if (!file) {
      throw new BadRequestException('A document file is required.');
    }

    const scanResult = await this.malwareService.scanBuffer(file.buffer);
    if (scanResult.isInfected) {
      throw new BadRequestException(
        `The uploaded file is infected with malware: ${scanResult.viruses.join(', ')}`,
      );
    }
    const text = await this.extractText(file);
    if (!text.text.trim()) {
      throw new BadRequestException(
        'No readable text was found in the document.',
      );
    }
    const inspection = inspectExtractedText(text.text);
    if (inspection.isSuspicious) {
      throw new BadRequestException(
        `Document contains possible prompt-injection instructions: ${inspection.promptInjectionIndicators.join(', ')}.`,
      );
    }
    return this.enterCompanyData({
      ...metadata,
      sourceType: 'upload',
      text: inspection.normalizedText,
    });
  }

  async classificationHelper(query: string, conversationId?: string) {
    if (!conversationId) {
      return { kind: 'standalone', searchQuery: query };
    }

    const messages = await this.conversationMessageTable.find({
      where: { conversationId },
      select: { role: true, content: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 4,
    });
    if (messages.length === 0) {
      return { kind: 'standalone', searchQuery: query };
    }

    const history = messages
      .reverse()
      .map(({ role, content }) => ({ role, content }));
    return classifyQuestion(history, query);
  }
  async userQuestion(
    companyId: string,
    query: string,
    conversationId?: string,
    userId?: string,
  ) {
    const timing = new PipelineTiming();
    const question = typeof query === 'string' ? query.trim() : '';
    if (!question) {
      throw new BadRequestException('A question is required.');
    }
    if (conversationId && !/^\d+$/.test(conversationId)) {
      throw new BadRequestException('Invalid conversation ID.');
    }

    const conversation = await timing.measure(
      'conversation',
      () => this.getOrCreateConversation(companyId, userId, conversationId),
    );

    console.log("Conversation : ",conversation);

    const intentHistory = await timing.measure(
      'history',
      () => this.getRecentConversationHistory(conversation.id),
    );

    console.log("Intent History : ",intentHistory);
    const intentResult = await timing.measure('intent_detection', () =>
      detectCustomerIntent(question, {
        bookingFlowState: conversation.bookingFlowState,
        history: intentHistory,
      }),
    );

    console.log("Intent Result : ",intentResult)

    if (
      intentResult.intent === 'book_appointment' ||
      intentResult.intent === 'provide_booking_details' ||
      intentResult.intent === 'confirm_booking' ||
      intentResult.intent === 'cancel_booking' ||
      intentResult.intent === 'reschedule_booking'
    ) {
      const bookingReply = await timing.measure('booking_action', () =>
        this.bookingService.handleIntent({
          conversation,
          intent: intentResult.intent,
          entities: intentResult.entities,
          customerMessage: question,
        }),
      );

      console.log("Booking Reply : ",bookingReply);
      return this.saveAndReturn(
        companyId,
        conversation,
        question,
        bookingReply.answer,
        'booking',
        userId,
        timing,
      );
    }

    const directAnswer = await timing.measure(
      'direct_answer_lookup',
      () => this.directAnswers.findAnswer(companyId, question),
    );
    if (directAnswer) {
      return this.saveAndReturn(
        companyId,
        conversation,
        question,
        directAnswer,
        'direct',
        userId,
        timing,
      );
    }

    const classifiedQuestion = await timing.measure(
      'question_classification',
      () => this.classificationHelper(question, conversation.id),
    );

    const cacheQuestion = classifiedQuestion.searchQuery;
    const cachedAnswer = await timing.measure('exact_cache_lookup', () =>
      this.answerCache.get(companyId, cacheQuestion),
    );
    if (cachedAnswer) {
      return this.saveAndReturn(
        companyId,
        conversation,
        question,
        cachedAnswer,
        'cache',
        userId,
        timing,
      );
    }

    const queryEmbedding = await timing.measure('query_embedding', () =>
      getQueryEmbedding(cacheQuestion),
    );
    console.log("Query Embeddings : ",queryEmbedding)
    const semanticMatch = await timing.measure('semantic_cache_lookup', () =>
      this.semanticCache.findSimilar(companyId, queryEmbedding),
    );
    if (semanticMatch) {
      await timing.measure('exact_cache_write', () =>
        this.answerCache.set(companyId, cacheQuestion, semanticMatch.answer),
      );
      return this.saveAndReturn(
        companyId,
        conversation,
        question,
        semanticMatch.answer,
        'semantic-cache',
        userId,
        timing,
      );
    }

    const { answer, chunkIds } = await this.generateRagAnswer(
      companyId, cacheQuestion, queryEmbedding, timing,
    );

    await timing.measure('cache_writes', () =>
      Promise.all([
        this.answerCache.set(companyId, cacheQuestion, answer),
        this.semanticCache.set({
          companyId,
          question: cacheQuestion,
          answer,
          embedding: queryEmbedding,
          chunkIds,
        }),
      ]),
    );

    return this.saveAndReturn(
      companyId,
      conversation,
      question,
      answer,
      'rag',
      userId,
      timing,
    );
  }

  private async getOrCreateConversation(
    companyId: string,
    userId?: string,
    conversationId?: string,
  ) {
    if (conversationId) {
      const conversation = await this.conversationTable.findOne({
        where: {
          id: conversationId,
          companyId,
          ...(userId ? { userId } : {}),
        },
      });
      if (!conversation) {
        throw new NotFoundException('Conversation not found for this company.');
      }
      return conversation;
    }

    return this.conversationTable.save(
      this.conversationTable.create({
        companyId,
        userId: userId ?? null,
        bookingFlowState: BookingFlowState.NONE,
        bookingDraft: {},
      }),
    );
  }

  private async getRecentConversationHistory(conversationId: string) {
    const messages = await this.conversationMessageTable.find({
      where: { conversationId },
      select: { role: true, content: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 6,
    });
    return messages.reverse().map(({ role, content }) => ({ role, content }));
  }

  private async saveConversationTurn(
    conversationId: string,
    question: string,
    answer: string,
  ) {
    await this.conversationMessageTable.save([
      this.conversationMessageTable.create({
        conversationId,
        role: 'user',
        content: question,
      }),
      this.conversationMessageTable.create({
        conversationId,
        role: 'assistant',
        content: answer,
      }),
    ]);
  }

  async generateRagAnswer(
    companyId: string,
    question: string,
    embedding: number[],
    timing?: PipelineTiming,
  ) {
    const retrieved = timing
      ? await timing.measure('vector_retrieval', () =>
          this.retrieveChunksByEmbedding(companyId, embedding, 3),
        )
      : await this.retrieveChunksByEmbedding(companyId, embedding, 3);
    const context = this.buildContext(retrieved.map(({ chunk }) => chunk));
    const answer =
      (timing
        ? await timing.measure('answer_generation', () =>
            getResponseFromGemini(context, question),
          )
        : await getResponseFromGemini(context, question))?.trim() ||
      'I could not find an answer in the company knowledge base.';
    return {
      answer,
      chunkIds: retrieved.map(({ chunk }) => chunk.id as string),
    };
  }

  private async saveAndReturn(
    companyId: string,
    conversation: Conversation | null,
    question: string,
    answer: string,
    source: 'direct' | 'cache' | 'semantic-cache' | 'rag' | 'booking',
    userId?: string,
    timing?: PipelineTiming,
  ) {
    const activeConversation =
      conversation ??
      (await this.conversationTable.save(
        this.conversationTable.create({ companyId, userId: userId ?? null }),
      ));

    if (timing) {
      await timing.measure('save_messages', () =>
        this.saveConversationTurn(activeConversation.id, question, answer),
      );
      timing.log(this.logger, source);
    } else {
      await this.saveConversationTurn(activeConversation.id, question, answer);
    }

    return {
      answer,
      conversationId: activeConversation.id,
      source,
    };
  }

  async evaluateRetrieval(cases: any[]) {
    let hits = 0;
    let reciprocalRankTotal = 0;
    let factCoverageTotal = 0;
    let precisionTotal = 0;
    let answerableCases = 0;

    for (const testCase of cases) {
      const results = await this.retrieveChunks(
        testCase.companyId,
        testCase.question,
        3,
      );

      // Unanswerable questions have no expected facts.
      // They need separate threshold-based evaluation.
      if (!testCase.shouldAnswer) {
        continue;
      }

      answerableCases++;

      const combinedContext = results
        .map(({ chunk }) => chunk.content)
        .join(' ')
        .toLowerCase();

      const factsFound = testCase.expectedFacts.filter((fact: string) =>
        combinedContext.includes(fact.toLowerCase()),
      ).length;

      const caseFactCoverage =
        testCase.expectedFacts.length > 0
          ? factsFound / testCase.expectedFacts.length
          : 0;

      factCoverageTotal += caseFactCoverage;

      const relevantResults = results.filter(({ chunk }) =>
        testCase.expectedFacts.some((fact: string) =>
          chunk.content.toLowerCase().includes(fact.toLowerCase()),
        ),
      );

      const casePrecision =
        results.length > 0 ? relevantResults.length / results.length : 0;

      precisionTotal += casePrecision;

      const correctIndex = results.findIndex(({ chunk }) => {
        const correctDocument =
          chunk.document.title === testCase.sourceDocument;

        const containsExpectedFact = testCase.expectedFacts.some(
          (fact: string) =>
            chunk.content.toLowerCase().includes(fact.toLowerCase()),
        );

        return correctDocument && containsExpectedFact;
      });

      if (correctIndex >= 0) {
        hits++;
        reciprocalRankTotal += 1 / (correctIndex + 1);
      }
    }

    return {
      totalQuestions: cases.length,
      answerableQuestions: answerableCases,

      hitAt3: answerableCases > 0 ? hits / answerableCases : 0,

      meanReciprocalRank:
        answerableCases > 0 ? reciprocalRankTotal / answerableCases : 0,

      factCoverage:
        answerableCases > 0 ? factCoverageTotal / answerableCases : 0,

      precisionAt3: answerableCases > 0 ? precisionTotal / answerableCases : 0,
    };
  }
  private async retrieveChunks(
    companyId: string,
    query: string,
    limit = 3,
  ): Promise<any[]> {
    const embedding = await getQueryEmbedding(query.trim());
    return this.retrieveChunksByEmbedding(companyId, embedding, limit);
  }

  private async retrieveChunksByEmbedding(
    companyId: string,
    embedding: number[],
    limit = 3,
  ): Promise<any[]> {
    const vector = JSON.stringify(embedding);

    const result = await this.chunkTable
      .createQueryBuilder('chunk')
      .innerJoinAndSelect('chunk.document', 'document')
      .addSelect('chunk.embedding <=> CAST(:vector AS vector)', 'distance')
      .where('chunk.companyId = :companyId', { companyId })
      .setParameter('vector', vector)
      .orderBy('distance', 'ASC')
      .limit(limit)
      .getRawAndEntities();

    return result.entities.map((chunk, index) => ({
      chunk,
      distance: Number(result.raw[index].distance),
    }));
  }

  private buildContext(chunks: any[]): string {
    return chunks
      .map((chunk, index) =>
        `
[Source ${index + 1}]
Document: ${chunk.document.title}
Chunk: ${chunk.chunkIndex}
Content: ${chunk.content}
      `.trim(),
      )
      .join('\n\n');
  }

  private createChunks(text: string, chunkSize = 300, overlap = 50): string[] {
    const words = text.trim().split(/\s+/);
    const chunks: string[] = [];
    const step = chunkSize - overlap;

    for (let index = 0; index < words.length; index += step) {
      const chunk = words.slice(index, index + chunkSize).join(' ');

      if (chunk) {
        chunks.push(chunk);
      }
    }

    return chunks;
  }

  private async extractText(file: Express.Multer.File): Promise<any> {
    const extension = file.originalname.split('.').pop()?.toLowerCase();

    if (extension === 'txt') {
      return { text: file.buffer.toString('utf8') };
    }

    if (extension === 'docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return { text: result.value };
    }

    if (extension !== 'pdf') {
      throw new BadRequestException(
        'Only PDF, DOCX, and TXT files are supported.',
      );
    }

    const parser = new PDFParse({ data: file.buffer });

    try {
      const result = await parser.getText();
      const info = await parser.getInfo();
      return {
        text: result.text,
        totalPages: result.total,
        info: info.info,
      };
    } finally {
      await parser.destroy();
    }
  }
}

class PipelineTiming {
  private readonly startedAt = performance.now();
  private readonly stages: Record<string, number> = {};

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const stageStartedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.stages[name] = roundMilliseconds(
        (this.stages[name] ?? 0) + performance.now() - stageStartedAt,
      );
    }
  }

  log(logger: Logger, source: string) {
    const [longestStage, longestStageMs] = Object.entries(this.stages).reduce(
      (longest, current) => current[1] > longest[1] ? current : longest,
      ['', 0],
    );
    logger.log(
      `Chat pipeline timing ${JSON.stringify({
        source,
        totalMs: roundMilliseconds(performance.now() - this.startedAt),
        longestStage,
        longestStageMs,
        stages: this.stages,
      })}`,
    );
  }
}

function roundMilliseconds(value: number) {
  return Math.round(value * 10) / 10;
}
