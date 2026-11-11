import { Column, Entity, Check, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UuidEntity } from '../../../common/entities/uuid-entity';
import { Order } from './order.entity';
import { User } from '../../users/entities/user.entity';

@Entity('order_status_history')
@Check(
  'history_transition_valid',
  "(previous_status IS NULL AND new_status = 'PENDING_PAYMENT' AND actor_user_id IS NULL) OR (previous_status IS NOT NULL AND ((previous_status = 'PENDING_PAYMENT' AND new_status IN ('PAID','CANCELLED','EXPIRED')) OR (previous_status = 'PAID' AND new_status = 'PROCESSING') OR (previous_status = 'PROCESSING' AND new_status = 'SHIPPED') OR (previous_status = 'SHIPPED' AND new_status = 'COMPLETED')))",
)
@Check(
  'history_human_actor',
  "new_status NOT IN ('CANCELLED','PROCESSING','SHIPPED','COMPLETED') OR actor_user_id IS NOT NULL",
)
@Index('history_order_time_idx', ['orderId', 'createdAt', 'id'])
@Index('history_actor_idx', ['actorUserId'])
@Index('history_one_initial_idx', ['orderId'], {
  unique: true,
  where: 'previous_status IS NULL',
})
export class OrderStatusHistory extends UuidEntity {
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({
    name: 'previous_status',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  previousStatus!: string | null;

  @Column({ name: 'new_status', type: 'varchar', length: 24 })
  newStatus!: string;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne(() => Order, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'order_status_history_order_id_fkey',
  })
  orderRelation?: Order;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'actor_user_id',
    foreignKeyConstraintName: 'order_status_history_actor_user_id_fkey',
  })
  actorUserRelation?: User | null;
}
