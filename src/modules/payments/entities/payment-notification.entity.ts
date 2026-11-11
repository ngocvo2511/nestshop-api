import { Column, Entity, Check, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UuidEntity } from '../../../common/entities/uuid-entity';
import { Payment } from './payment.entity';

@Entity('payment_notifications')
@Check(
  'notification_outcome_valid',
  "outcome IN ('SETTLED','FAILED','DUPLICATE','INVALID','MISMATCH','UNKNOWN_REFERENCE','LATE','CONFLICT')",
)
@Check(
  'notification_verified_effect',
  "outcome NOT IN ('SETTLED','FAILED') OR (signature_verified AND payment_id IS NOT NULL AND reported_amount_vnd IS NOT NULL AND reported_amount_vnd > 0 AND reported_currency IS NOT NULL AND reported_currency = 'VND')",
)
@Index('notification_payment_time_idx', ['paymentId', 'receivedAt', 'id'])
@Index('notification_outcome_time_idx', ['outcome', 'receivedAt', 'id'])
@Index('notification_correlation_idx', ['correlationId'])
export class PaymentNotification extends UuidEntity {
  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId!: string | null;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId!: string;

  @Column({
    name: 'provider_reference',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  providerReference!: string | null;

  @Column({
    name: 'provider_transaction_reference',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  providerTransactionReference!: string | null;

  @Column({ name: 'signature_verified', type: 'boolean' })
  signatureVerified!: boolean;

  @Column({ name: 'reported_amount_vnd', type: 'bigint', nullable: true })
  reportedAmountVnd!: string | null;

  @Column({
    name: 'reported_currency',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  reportedCurrency!: string | null;

  @Column({
    name: 'response_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  responseCode!: string | null;

  @Column({
    name: 'transaction_status_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  transactionStatusCode!: string | null;

  @Column({ name: 'outcome', type: 'varchar', length: 24 })
  outcome!: string;

  @Column({ name: 'safe_detail', type: 'text', nullable: true })
  safeDetail!: string | null;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt!: Date;

  @ManyToOne(() => Payment, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'payment_id',
    foreignKeyConstraintName: 'payment_notifications_payment_id_fkey',
  })
  paymentRelation?: Payment | null;
}
