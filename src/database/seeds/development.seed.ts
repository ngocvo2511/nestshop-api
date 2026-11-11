import { DataSource } from 'typeorm';
import { Product } from '../../modules/products/entities/product.entity';

export const developmentProducts = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Demo notebook',
    priceVnd: '45000',
    stockAvailable: 20,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Demo pen',
    priceVnd: '12000',
    stockAvailable: 50,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    name: 'Demo backpack',
    priceVnd: '350000',
    stockAvailable: 10,
  },
];

/** Insert missing fixed IDs only. Never resets existing stock, price, image or names. */
export async function seedDevelopment(
  source: DataSource,
  environment: string,
): Promise<void> {
  if (!['development', 'test'].includes(environment))
    throw new Error('Development seed is forbidden outside development/test');
  await source.transaction(async (manager) => {
    await manager
      .createQueryBuilder()
      .insert()
      .into(Product)
      .values(developmentProducts)
      .orIgnore()
      .execute();
  });
}
