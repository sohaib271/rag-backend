import {
  BadRequestException,
  Injectable,
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
import { Conversation } from '../entities/conversations.entity.js';
import { ConversationMessage } from '../entities/conversation-message.entity.js';
import { classifyQuestion } from './genai/classification.js';
import { DirectAnswerService } from './direct-answer.service.js';
import { AnswerCacheService } from './redis/exact-cache/answerCache.service.js';
import { SemanticCacheService } from './redis/semantic-cache/semanticCache.service.js';

@Injectable()
export class CompanyService {
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
  ) {}

  async createCompany(name: string) {
    const company = this.companyTable.create({ name: name.trim() });
    return this.companyTable.save(company);
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
  ) {
    const question = typeof query === 'string' ? query.trim() : '';
    if (!question) {
      throw new BadRequestException('A question is required.');
    }
    if (conversationId && !/^\d+$/.test(conversationId)) {
      throw new BadRequestException('Invalid conversation ID.');
    }

    const conversation = conversationId
      ? await this.conversationTable.findOne({
          where: { id: conversationId, companyId },
        })
      : null;
    if (conversationId && !conversation) {
      throw new NotFoundException('Conversation not found for this company.');
    }

    const directAnswer = await this.directAnswers.findAnswer(
      companyId,
      question,
    );

    if (directAnswer) {
      return this.saveAndReturn(
        companyId,
        conversation,
        question,
        directAnswer,
        'direct',
      );
    }

    const classifiedQuestion = await this.classificationHelper(
      question,
      conversation?.id,
    );

    const cacheQuestion = classifiedQuestion.searchQuery;
    console.log("Classified : ",cacheQuestion)
    const cachedAnswer = await this.answerCache.get(companyId, cacheQuestion);
    if (cachedAnswer) {
      return this.saveAndReturn(
        companyId,
        conversation,
        question,
        cachedAnswer,
        'cache',
      );
    }

    const queryEmbedding = await getQueryEmbedding(cacheQuestion);
    const semanticMatch = await this.semanticCache.findSimilar(
      companyId,
      queryEmbedding,
    );
    console.log("Semantic Match : ",semanticMatch)
    if (semanticMatch) {
      await this.answerCache.set(companyId, cacheQuestion, semanticMatch.answer);
      return this.saveAndReturn(
        companyId,
        conversation,
        question,
        semanticMatch.answer,
        'semantic-cache',
      );
    }

    const { answer, chunkIds } = await this.generateRagAnswer(
      companyId,
      cacheQuestion,
      queryEmbedding,
    );

    await Promise.all([
      this.answerCache.set(companyId, cacheQuestion, answer),
      this.semanticCache.set({
        companyId,
        question: cacheQuestion,
        answer,
        embedding: queryEmbedding,
        chunkIds,
      }),
    ]);

    return this.saveAndReturn(companyId, conversation, question, answer, 'rag');
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
  ) {
    const retrieved = await this.retrieveChunksByEmbedding(companyId, embedding, 3);
    const context = this.buildContext(retrieved.map(({ chunk }) => chunk));
    const answer = (
      (
        await getResponseFromGemini(context, question)
      )?.trim() || 'I could not find an answer in the company knowledge base.'
    );
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
    source: 'direct' | 'cache' | 'semantic-cache' | 'rag',
  ) {
    const activeConversation =
      conversation ??
      (await this.conversationTable.save(
        this.conversationTable.create({ companyId }),
      ));

    await this.saveConversationTurn(activeConversation.id, question, answer);

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
