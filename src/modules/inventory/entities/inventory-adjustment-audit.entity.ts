import { Column, Entity, Check, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UuidEntity } from '../../../common/entities/uuid-entity';
import { Product } from '../../products/entities/product.entity';
import { User } from '../../users/entities/user.entity';

@Entity('inventory_adjustment_audit')
@Check(
  'inventory_audit_quantities',
  'previous_stock >= 0 AND new_stock >= 0 AND quantity_delta <> 0 AND previous_stock::bigint + quantity_delta::bigint = new_stock::bigint',
)
@Check('inventory_audit_reason', 'length(btrim(reason)) > 0')
@Index('inventory_audit_product_time_idx', ['productId', 'createdAt', 'id'])
@Index('inventory_audit_actor_idx', ['actorUserId'])
export class InventoryAdjustmentAudit extends UuidEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  @Column({ name: 'previous_stock', type: 'integer' })
  previousStock!: number;

  @Column({ name: 'quantity_delta', type: 'integer' })
  quantityDelta!: number;

  @Column({ name: 'new_stock', type: 'integer' })
  newStock!: number;

  @Column({ name: 'reason', type: 'text' })
  reason!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne(() => Product, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'inventory_adjustment_audit_product_id_fkey',
  })
  productRelation?: Product;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'actor_user_id',
    foreignKeyConstraintName: 'inventory_adjustment_audit_actor_user_id_fkey',
  })
  actorUserRelation?: User;
}
