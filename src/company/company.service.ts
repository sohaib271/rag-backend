import { BadRequestException, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Company } from '../entities/company.entity.js';
import { InjectRepository } from '@nestjs/typeorm';
import { Document } from '../entities/document.entity.js';
import { DocumentChunk } from '../entities/document-chunk.entity.js';
import { Documentdata } from './dto/document-chunk.dto.js';
import { getEmbeddings } from './genai/embedding.js';
import { getResponseFromGemini } from './genai/response.js';
import { PDFParse } from "pdf-parse";
import mammoth from 'mammoth';

@Injectable()
export class CompanyService {
     constructor(
    @InjectRepository(Company)
    private readonly companyTable: Repository<Company>,
    @InjectRepository(Document)
    private readonly documentTable: Repository<Document>,
    @InjectRepository(DocumentChunk)
    private readonly chunkTable: Repository<DocumentChunk>
  ) {}

  async createCompany(name: string){
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
      documentCounts.map(({ companyId, documentCount }) => [companyId, Number(documentCount)]),
    );

    return companies.map((company) => ({
      id: company.id,
      name: company.name,
      createdAt: company.createdAt,
      documentCount: counts.get(company.id) ?? 0,
    }));
  }
  async enterCompanyData(dto:Documentdata){
    const chunks = this.createChunks(dto.text);
    const embeddings = await getEmbeddings(
      chunks.map((content) => content),
    );

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

    return { document, chunksCreated: documentChunks.length };
  }

  async enterCompanyFileData(
    file: Express.Multer.File,
    metadata: { companyId: string; title: string; status?: Documentdata['status'] },
  ) {
    if (!file) {
      throw new BadRequestException('A document file is required.');
    }

    const text = await this.extractText(file);
    if (!text.trim()) {
      throw new BadRequestException('No readable text was found in the document.');
    }
    return this.enterCompanyData({
      ...metadata,
      sourceType: 'upload',
      text,
    });
  }

  async userQuestion(companyId: string, query: string) {
    const retrieved = await this.retrieveChunks(companyId, query, 3);
    const context = this.buildContext(retrieved.map(({ chunk }) => chunk));
    const answer = await getResponseFromGemini(context, query);
    return { answer: answer ?? 'I could not find an answer in the company knowledge base.' };
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

    const factsFound = testCase.expectedFacts.filter(
      (fact: string) =>
        combinedContext.includes(fact.toLowerCase()),
    ).length;

    const caseFactCoverage =
      testCase.expectedFacts.length > 0
        ? factsFound / testCase.expectedFacts.length
        : 0;

    factCoverageTotal += caseFactCoverage;

    const relevantResults = results.filter(({ chunk }) =>
      testCase.expectedFacts.some((fact: string) =>
        chunk.content
          .toLowerCase()
          .includes(fact.toLowerCase()),
      ),
    );

    const casePrecision =
      results.length > 0
        ? relevantResults.length / results.length
        : 0;

    precisionTotal += casePrecision;

    const correctIndex = results.findIndex(({ chunk }) => {
      const correctDocument =
        chunk.document.title === testCase.sourceDocument;

      const containsExpectedFact =
        testCase.expectedFacts.some((fact: string) =>
          chunk.content
            .toLowerCase()
            .includes(fact.toLowerCase()),
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

    hitAt3:
      answerableCases > 0
        ? hits / answerableCases
        : 0,

    meanReciprocalRank:
      answerableCases > 0
        ? reciprocalRankTotal / answerableCases
        : 0,

    factCoverage:
      answerableCases > 0
        ? factCoverageTotal / answerableCases
        : 0,

    precisionAt3:
      answerableCases > 0
        ? precisionTotal / answerableCases
        : 0,
  };
}
private async retrieveChunks(
  companyId: string,
  query: string,
  limit = 3,
): Promise<any[]> {
  const [questionEmbedding] = await getEmbeddings([query.trim() ]);
  const vector = JSON.stringify(questionEmbedding.values);

  const result = await this.chunkTable
    .createQueryBuilder('chunk')
    .innerJoinAndSelect('chunk.document', 'document')
    .addSelect(
      'chunk.embedding <=> CAST(:vector AS vector)',
      'distance',
    )
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
    .map(
      (chunk, index) => `
[Source ${index + 1}]
Document: ${chunk.document.title}
Chunk: ${chunk.chunkIndex}
Content: ${chunk.content}
      `.trim(),
    )
    .join('\n\n')
  }

  private createChunks(
  text: string,
  chunkSize = 300,
  overlap = 50,
): string[] {
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

private async extractText(file: Express.Multer.File): Promise<string> {
  const extension = file.originalname.split('.').pop()?.toLowerCase();

  if (extension === 'txt') {
    return file.buffer.toString('utf8');
  }

  if (extension === 'docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  if (extension !== 'pdf') {
    throw new BadRequestException('Only PDF, DOCX, and TXT files are supported.');
  }

  const parser = new PDFParse({ data: file.buffer });

  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}


}
