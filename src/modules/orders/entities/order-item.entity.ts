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
import { Order } from './order.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('order_items')
@Check('item_name_present', 'length(btrim(product_name)) > 0')
@Check('item_values_positive', 'unit_price_vnd > 0 AND quantity > 0')
@Unique('order_item_product_unique', ['orderId', 'productId'])
@Index('item_product_idx', ['productId'])
export class OrderItem extends UuidEntity {
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'product_name', type: 'varchar', length: 250 })
  productName!: string;

  @Column({ name: 'unit_price_vnd', type: 'bigint' })
  unitPriceVnd!: string;

  @Column({ name: 'quantity', type: 'integer' })
  quantity!: number;

  @Column({
    name: 'line_total_vnd',
    type: 'bigint',
    asExpression: 'unit_price_vnd * quantity::bigint',
    generatedType: 'STORED',
    insert: false,
    update: false,
    nullable: true,
  })
  lineTotalVnd!: string;

  @ManyToOne(() => Order, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'order_items_order_id_fkey',
  })
  orderRelation?: Order;

  @ManyToOne(() => Product, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'order_items_product_id_fkey',
  })
  productRelation?: Product;
}
