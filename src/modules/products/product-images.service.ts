import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiError } from '../../common/http/api-error';
import { SafeJsonLogger } from '../../common/logging/safe-json.logger';
import { databaseNow, transaction } from '../../database/transaction';
import { Product } from './entities/product.entity';
import { ImageContext, ImageStorage } from './image-storage';

@Injectable()
export class ProductImagesService {
  constructor(
    @Inject(DataSource) private readonly source: DataSource | null,
    private readonly storage: ImageStorage,
    private readonly logger: SafeJsonLogger,
  ) {}

  async upload(
    productId: string,
    file: Express.Multer.File | undefined,
    correlationId: string,
  ) {
    const context = { productId, correlationId };
    const image = await this.storage.encode(file);
    const reference = await this.storage.write(image, context);
    let previous: string | null;
    try {
      previous = await transaction(this.source, async (manager) => {
        const product = await manager
          .createQueryBuilder(Product, 'p')
          .where('p.id=:id', { id: productId })
          .setLock('pessimistic_write')
          .getOne();
        if (!product) throw new ApiError('NOT_FOUND');
        await manager.update(
          Product,
          { id: productId },
          { imagePath: reference, updatedAt: await databaseNow(manager) },
        );
        return product.imagePath;
      });
    } catch (error) {
      await this.cleanup(reference, context, 'orphan');
      throw error;
    }
    if (previous && previous !== reference)
      await this.cleanup(previous, context, 'superseded');
    return { productId, imageUrl: `/api/v1/products/${productId}/image` };
  }

  async read(productId: string) {
    // Read bytes while holding the product lock; replacement cannot delete this reference mid-read.
    return transaction(this.source, async (manager) => {
      const product = await manager
        .createQueryBuilder(Product, 'p')
        .where('p.id=:id AND p.isActive=true', { id: productId })
        .setLock('pessimistic_read')
        .getOne();
      if (!product?.imagePath) throw new ApiError('NOT_FOUND');
      return this.storage.read(product.imagePath);
    });
  }

  private async cleanup(
    reference: string,
    context: ImageContext,
    stage: 'orphan' | 'superseded',
  ) {
    try {
      if (!this.source) throw new Error();
      await transaction(this.source, async (manager) => {
        // Wait for any uncertain primary commit to release its owning product lock before deciding whether the file is orphaned.
        await manager
          .createQueryBuilder(Product, 'p')
          .where('p.id=:id', { id: context.productId })
          .setLock('pessimistic_write')
          .getOne();
        // Generated references are never reused/accepted from clients; also retain legacy shared references.
        if (
          await manager
            .getRepository(Product)
            .existsBy({ imagePath: reference })
        )
          return;
        await this.storage.remove(reference);
      });
    } catch {
      this.logger.imageCleanupFailed(
        context.productId,
        context.correlationId,
        stage,
      );
    }
  }
}
