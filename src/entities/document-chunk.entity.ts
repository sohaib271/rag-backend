import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Company } from './company.entity.js';   // Adjust paths based on your setup
import { Document } from './document.entity.js';

@Entity({ name: 'document_chunks' })
@Unique('document_chunks_position_unique', ['documentId', 'chunkIndex'])
@Index('document_chunks_company_id_idx', ['companyId'])
@Index('document_chunks_document_id_idx', ['documentId'])
export class DocumentChunk {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string; // Map BIGINT as string in TypeScript

  @Column({ name: 'company_id', type: 'bigint' })
  companyId: string;

  @Column({ name: 'document_id', type: 'bigint' })
  documentId: string;

  @Column({ name: 'chunk_index', type: 'integer' })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'vector',
    length: 768,
    transformer: {
      to: (value: number[]) => value ? JSON.stringify(value) : value,
      from: (value: string | number[]) => typeof value === 'string' ? JSON.parse(value) : value,
    },
  })
  embedding: number[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  // Relationships
  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;
}
