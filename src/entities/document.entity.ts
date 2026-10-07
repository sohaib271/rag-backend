import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { Company } from './company.entity.js'; // Adjust path based on your directory structure

@Entity({ name: 'documents' })
@Index('documents_company_id_idx', ['companyId'])
@Check('documents_status_check', `"status" IN ('draft', 'published', 'disabled')`)
export class Document {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string; // BIGINT is handled as a string in JavaScript/TypeScript to prevent precision loss

  @Column({ name: 'company_id', type: 'bigint' })
  companyId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'source_type', type: 'varchar', length: 50, default: 'manual' })
  sourceType: string;

  @Column({ type: 'varchar', length: 20, default: 'published' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  // Relationship definition mapping the foreign key constraint
  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
