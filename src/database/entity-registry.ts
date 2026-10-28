// Infrastructure composition only; entity ownership stays with each feature module.
import { User } from '../modules/users/entities/user.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { RoleChangeAudit } from '../modules/users/entities/role-change-audit.entity';
import { Product } from '../modules/products/entities/product.entity';
import { InventoryAdjustmentAudit } from '../modules/inventory/entities/inventory-adjustment-audit.entity';
import { Order } from '../modules/orders/entities/order.entity';
import { OrderItem } from '../modules/orders/entities/order-item.entity';
import { OrderStatusHistory } from '../modules/orders/entities/order-status-history.entity';
import { Payment } from '../modules/payments/entities/payment.entity';
import { PaymentNotification } from '../modules/payments/entities/payment-notification.entity';

export const entities = [
  User,
  RefreshToken,
  RoleChangeAudit,
  Product,
  InventoryAdjustmentAudit,
  Order,
  OrderItem,
  OrderStatusHistory,
  Payment,
  PaymentNotification,
];
