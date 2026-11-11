import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiError } from '../../common/http/api-error';
import { databaseNow, transaction } from '../../database/transaction';
import { Product } from '../products/entities/product.entity';
import { InventoryAdjustmentAudit } from './entities/inventory-adjustment-audit.entity';
import { StockAdjustmentDto } from './inventory.dto';

@Injectable()
export class InventoryService {
  constructor(@Inject(DataSource) private readonly source: DataSource | null) {}
  async adjust(
    actorUserId: string,
    productId: string,
    dto: StockAdjustmentDto,
  ) {
    return transaction(this.source, async (manager) => {
      const product = await manager
        .createQueryBuilder(Product, 'p')
        .where('p.id=:id', { id: productId })
        .setLock('pessimistic_write')
        .getOne();
      if (!product) throw new ApiError('NOT_FOUND');
      const next = BigInt(product.stockAvailable) + BigInt(dto.quantityDelta);
      if (next < 0n || next > 2147483647n)
        throw new ApiError('STOCK_RANGE_EXCEEDED');
      const now = await databaseNow(manager);
      const audit = manager.create(InventoryAdjustmentAudit, {
        actorUserId,
        productId,
        previousStock: product.stockAvailable,
        quantityDelta: dto.quantityDelta,
        newStock: Number(next),
        reason: dto.reason,
        createdAt: now,
      });
      await manager.update(
        Product,
        { id: productId },
        { stockAvailable: audit.newStock, updatedAt: now },
      );
      await manager.insert(InventoryAdjustmentAudit, audit);
      return {
        id: audit.id,
        productId,
        actorUserId,
        previousStock: audit.previousStock,
        quantityDelta: audit.quantityDelta,
        newStock: audit.newStock,
        reason: audit.reason,
        createdAt: now,
      };
    });
  }
}
