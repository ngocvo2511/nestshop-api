import { ApiError } from '../../common/http/api-error';
import { MAX_VND } from '../../common/validation/contract-validators';
import { Product } from '../products/entities/product.entity';
import { CheckoutItemDto } from './dto/checkout.dto';

export function calculateCheckout(
  items: CheckoutItemDto[],
  products: Product[],
) {
  const byId = new Map(products.map((product) => [product.id, product]));
  let total = 0n;
  const lines = items.map((item) => {
    const product = byId.get(item.productId);
    if (!product?.isActive || product.stockAvailable < item.quantity)
      throw new ApiError('INSUFFICIENT_STOCK');
    const lineTotal = BigInt(product.priceVnd) * BigInt(item.quantity);
    if (lineTotal > MAX_VND || total + lineTotal > MAX_VND)
      throw new ApiError('MONEY_LIMIT_EXCEEDED');
    total += lineTotal;
    return {
      product,
      quantity: item.quantity,
      lineTotalVnd: lineTotal.toString(),
    };
  });
  return { lines, totalVnd: total.toString() };
}
