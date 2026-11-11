import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiError } from '../../common/http/api-error';
import { databaseNow, transaction } from '../../database/transaction';
import { Product } from './entities/product.entity';
import {
  CreateProductDto,
  PatchProductDto,
  ProductQueryDto,
  ProductSort,
} from './products.dto';

export function publicProduct(product: Product) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceVnd: product.priceVnd,
    stockAvailable: product.stockAvailable,
    isActive: product.isActive,
    imageUrl: product.imagePath ? `/api/v1/products/${product.id}/image` : null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

const sorting: Record<ProductSort, readonly [string, 'ASC' | 'DESC']> = {
  name: ['p.name', 'ASC'],
  '-name': ['p.name', 'DESC'],
  priceVnd: ['p.priceVnd', 'ASC'],
  '-priceVnd': ['p.priceVnd', 'DESC'],
  createdAt: ['p.createdAt', 'ASC'],
  '-createdAt': ['p.createdAt', 'DESC'],
};

@Injectable()
export class ProductsService {
  constructor(@Inject(DataSource) private readonly source: DataSource | null) {}

  private db(): DataSource {
    if (!this.source) throw new ApiError('SERVICE_UNAVAILABLE');
    return this.source;
  }

  async list(query: ProductQueryDto) {
    if (
      query.minPriceVnd !== undefined &&
      query.maxPriceVnd !== undefined &&
      BigInt(query.minPriceVnd) > BigInt(query.maxPriceVnd)
    )
      throw new ApiError('VALIDATION_FAILED', [
        { field: 'minPriceVnd', rules: ['priceRange'] },
      ]);
    const builder = this.db()
      .getRepository(Product)
      .createQueryBuilder('p')
      .where('p.isActive = :active', { active: true });
    if (query.q !== undefined)
      builder.andWhere(
        "(p.name ILIKE :search ESCAPE '!' OR p.description ILIKE :search ESCAPE '!')",
        { search: `%${query.q.replace(/[!%_]/g, '!$&')}%` },
      );
    if (query.minPriceVnd !== undefined)
      builder.andWhere('p.priceVnd >= :min', { min: query.minPriceVnd });
    if (query.maxPriceVnd !== undefined)
      builder.andWhere('p.priceVnd <= :max', { max: query.maxPriceVnd });
    const [column, direction] = sorting[query.sort];
    const [products, total] = await builder
      .orderBy(column, direction)
      .addOrderBy('p.id', direction)
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: products.map(publicProduct),
      offset: query.offset,
      limit: query.limit,
      total,
    };
  }

  async detail(id: string) {
    const product = await this.db()
      .getRepository(Product)
      .findOneBy({ id, isActive: true });
    if (!product) throw new ApiError('NOT_FOUND');
    return publicProduct(product);
  }

  async create(dto: CreateProductDto) {
    const repo = this.db().getRepository(Product);
    const product = await repo.save(
      repo.create({
        name: dto.name,
        description: dto.description ?? null,
        priceVnd: dto.priceVnd,
        stockAvailable: dto.initialStock,
        isActive: dto.isActive,
        imagePath: null,
      }),
    );
    return publicProduct(product);
  }

  async update(id: string, dto: PatchProductDto) {
    if (
      [dto.name, dto.description, dto.priceVnd, dto.isActive].every(
        (value) => value === undefined,
      )
    )
      throw new ApiError('EMPTY_UPDATE');
    return transaction(this.source, async (manager) => {
      const product = await manager
        .createQueryBuilder(Product, 'p')
        .where('p.id=:id', { id })
        .setLock('pessimistic_write')
        .getOne();
      if (!product) throw new ApiError('NOT_FOUND');
      const changes: Partial<Product> = {
        updatedAt: await databaseNow(manager),
      };
      if (dto.name !== undefined) changes.name = dto.name;
      if (dto.description !== undefined) changes.description = dto.description;
      if (dto.priceVnd !== undefined) changes.priceVnd = dto.priceVnd;
      if (dto.isActive !== undefined) changes.isActive = dto.isActive;
      await manager.update(Product, { id }, changes);
      return publicProduct(Object.assign(product, changes));
    });
  }
}
