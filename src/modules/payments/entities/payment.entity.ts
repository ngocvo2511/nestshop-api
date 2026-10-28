import {
  Column,
  Entity,
  Check,
  Unique,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UuidEntity } from '../../../common/entities/uuid-entity';
import { Order } from '../../orders/entities/order.entity';

@Entity('payments')
@Check(
  'payment_status_valid',
  "status IN ('PENDING','SUCCESS','FAILED','EXPIRED')",
)
@Check('payment_provider_valid', "provider = 'VNPAY'")
@Check('payment_currency_valid', "currency = 'VND'")
@Check('payment_amount_positive', 'amount_vnd > 0')
@Check(
  'payment_reference_present',
  'length(btrim(provider_reference)) > 0 AND length(btrim(payment_url)) > 0',
)
@Check('payment_expiry_valid', 'expires_at > created_at')
@Check(
  'payment_terminal_valid',
  "(status = 'PENDING' AND terminal_at IS NULL) OR (status <> 'PENDING' AND terminal_at IS NOT NULL AND terminal_at >= created_at)",
)
@Unique('payments_provider_reference_key', ['providerReference'])
@Index('payment_order_time_idx', ['orderId', 'createdAt', 'id'])
@Index('payment_one_pending_idx', ['orderId'], {
  unique: true,
  where: "status = 'PENDING'",
})
@Index('payment_one_success_idx', ['orderId'], {
  unique: true,
  where: "status = 'SUCCESS'",
})
@Index('payment_due_idx', ['expiresAt', 'id'], { where: "status = 'PENDING'" })
export class Payment extends UuidEntity {
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'provider', type: 'varchar', length: 16, default: 'VNPAY' })
  provider!: string;

  @Column({ name: 'provider_reference', type: 'varchar', length: 100 })
  providerReference!: string;

  @Column({
    name: 'provider_transaction_reference',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  providerTransactionReference!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'PENDING' })
  status!: string;

  @Column({ name: 'amount_vnd', type: 'bigint' })
  amountVnd!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'VND' })
  currency!: string;

  @Column({ name: 'payment_url', type: 'text', select: false })
  paymentUrl!: string;

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

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'terminal_at', type: 'timestamptz', nullable: true })
  terminalAt!: Date | null;

  @ManyToOne(() => Order, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'payments_order_id_fkey',
  })
  orderRelation?: Order;
}
