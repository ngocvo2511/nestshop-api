import { Column, Entity, Check, Index } from 'typeorm';
import { UuidEntity } from '../../../common/entities/uuid-entity';

@Entity('products')
@Check('product_name_present', 'length(btrim(name)) > 0')
@Check('product_price_positive', 'price_vnd > 0')
@Check('product_stock_nonnegative', 'stock_available >= 0')
@Check(
  'product_image_relative',
  "image_path IS NULL OR (length(btrim(image_path)) > 0 AND image_path !~ '(^/|[\\\\:]|(^|/)\\.\\.(/|$))')",
)
@Index('product_public_name_idx', ['isActive', 'name', 'id'])
@Index('product_public_price_idx', ['isActive', 'priceVnd', 'id'])
export class Product extends UuidEntity {
  @Column({ name: 'name', type: 'varchar', length: 250 })
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'price_vnd', type: 'bigint' })
  priceVnd!: string;

  @Column({ name: 'stock_available', type: 'integer' })
  stockAvailable!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'image_path', type: 'varchar', length: 512, nullable: true })
  imagePath!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
