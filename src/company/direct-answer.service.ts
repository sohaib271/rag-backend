import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../entities/company.entity.js';
import { DirectAnswer } from '../entities/direct-answer.entity.js';

export type DirectAnswerInput = {
  companyId: string;
  question: string;
  answer: string;
  phrases?: string[];
  enabled?: boolean;
  showAsSuggestion?: boolean;
};

export type DirectAnswerUpdate = Partial<Omit<DirectAnswerInput, 'companyId'>>;

@Injectable()
export class DirectAnswerService {
  constructor(
    @InjectRepository(DirectAnswer) private readonly answers: Repository<DirectAnswer>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
  ) {}

  list(companyId: string) {
    return this.answers.find({ where: { companyId }, order: { createdAt: 'ASC' } });
  }

  suggestions(companyId: string) {
    if (process.env.DIRECT_ANSWERS_ENABLED === 'false') return [];
    return this.answers.find({
      where: { companyId, enabled: true, showAsSuggestion: true },
      select: { id: true, question: true },
      order: { createdAt: 'ASC' },
      take: 6,
    });
  }

  async companyIdForAnswer(id: string) {
    const answer = await this.answers.findOne({ where: { id }, select: { companyId: true } });
    if (!answer) throw new NotFoundException('Direct answer not found.');
    return answer.companyId;
  }

  async create(input: DirectAnswerInput) {
    this.requireQuestionAndAnswer(input.question, input.answer);
    if (!await this.companies.existsBy({ id: input.companyId })) {
      throw new NotFoundException('Company not found.');
    }
    return this.answers.save(this.answers.create({
      ...input,
      question: input.question.trim(),
      answer: input.answer.trim(),
      phrases: cleanPhrases(input.phrases),
      enabled: input.enabled ?? true,
      showAsSuggestion: input.showAsSuggestion ?? true,
    }));
  }

  async update(id: string, input: DirectAnswerUpdate) {
    const answer = await this.answers.findOneBy({ id });
    if (!answer) throw new NotFoundException('Direct answer not found.');

    Object.assign(answer, input);
    if (input.question !== undefined) answer.question = input.question.trim();
    if (input.answer !== undefined) answer.answer = input.answer.trim();
    if (input.phrases !== undefined) answer.phrases = cleanPhrases(input.phrases);
    this.requireQuestionAndAnswer(answer.question, answer.answer);
    return this.answers.save(answer);
  }

  async remove(id: string) {
    const result = await this.answers.delete(id);
    if (!result.affected) throw new NotFoundException('Direct answer not found.');
    return { deleted: true };
  }

  async findAnswer(companyId: string, question: string) {
    if (process.env.DIRECT_ANSWERS_ENABLED === 'false') return null;
    const expected = normalize(question);
    const answers = await this.answers.findBy({ companyId, enabled: true });
    return answers.find(({ question, phrases }) =>
      [question, ...phrases].some((phrase) => normalize(phrase) === expected),
    )?.answer ?? null;
  }

  private requireQuestionAndAnswer(question: string, answer: string) {
    if (!question?.trim() || !answer?.trim()) {
      throw new BadRequestException('Question and answer are required.');
    }
  }
}

const cleanPhrases = (phrases: string[] = []) =>
  [...new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean))];

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

