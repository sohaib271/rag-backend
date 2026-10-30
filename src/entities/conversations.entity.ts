import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Company } from "./company.entity.js";

export enum BookingFlowState {
  NONE = 'none',
  COLLECTING_DETAILS = 'collecting_details',
  AWAITING_CONFIRMATION = 'awaiting_confirmation',
}

export type BookingDraft = {
  serviceId?: string;
  serviceName?: string;
  date?: string;
  time?: string;
  startsAt?: string;
  endsAt?: string;
  rescheduleBookingId?: string;
};

@Entity('conversations')
@Index (['companyId'])
export class Conversation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'company_id', type: 'bigint' })
  companyId: string;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId: string | null;

  @Column({
    name: 'booking_flow_state',
    type: 'enum',
    enum: BookingFlowState,
    enumName: 'booking_flow_state',
    default: BookingFlowState.NONE,
  })
  bookingFlowState: BookingFlowState;

  @Column({
    name: 'booking_draft',
    type: 'jsonb',
    default: () => "'{}'",
  })
  bookingDraft: BookingDraft;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

   @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
