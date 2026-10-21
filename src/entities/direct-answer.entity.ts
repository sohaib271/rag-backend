import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from './company.entity.js';

@Entity('direct_answers')
@Index('direct_answers_company_id_idx', ['companyId'])
export class DirectAnswer {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'company_id', type: 'bigint' })
  companyId: string;

  @Column({ type: 'varchar', length: 160 })
  question: string;

  @Column({ type: 'text' })
  answer: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  phrases: string[];

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'show_as_suggestion', type: 'boolean', default: true })
  showAsSuggestion: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
