import { Column, Entity, Check, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UuidEntity } from '../../../common/entities/uuid-entity';
import { User } from '../../users/entities/user.entity';

@Entity('orders')
@Check(
  'order_status_valid',
  "status IN ('PENDING_PAYMENT','PAID','PROCESSING','SHIPPED','COMPLETED','CANCELLED','EXPIRED')",
)
@Check('order_total_positive', 'total_vnd > 0')
@Check(
  'order_shipping_present',
  'length(btrim(recipient_name)) > 0 AND length(btrim(recipient_phone)) > 0 AND length(btrim(address_line)) > 0 AND length(btrim(province_city)) > 0',
)
@Check('order_expiry_valid', 'reservation_expires_at > created_at')
@Index('order_customer_time_idx', ['userId', 'createdAt', 'id'])
@Index('order_queue_idx', ['status', 'createdAt', 'id'])
@Index('order_due_idx', ['reservationExpiresAt', 'id'], {
  where: "status = 'PENDING_PAYMENT'",
})
export class Order extends UuidEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 24,
    default: 'PENDING_PAYMENT',
  })
  status!: string;

  @Column({ name: 'total_vnd', type: 'bigint' })
  totalVnd!: string;

  @Column({ name: 'recipient_name', type: 'varchar', length: 200 })
  recipientName!: string;

  @Column({ name: 'recipient_phone', type: 'varchar', length: 32 })
  recipientPhone!: string;

  @Column({ name: 'address_line', type: 'varchar', length: 500 })
  addressLine!: string;

  @Column({ name: 'ward', type: 'varchar', length: 150, nullable: true })
  ward!: string | null;

  @Column({ name: 'district', type: 'varchar', length: 150, nullable: true })
  district!: string | null;

  @Column({ name: 'province_city', type: 'varchar', length: 150 })
  provinceCity!: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'reservation_expires_at', type: 'timestamptz' })
  reservationExpiresAt!: Date;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'orders_user_id_fkey',
  })
  userRelation?: User;
}
