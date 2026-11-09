import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ApiError } from '../../common/http/api-error';
import { Configuration } from '../../config/configuration';
import { databaseNow, transaction } from '../../database/transaction';
import { Product } from '../products/entities/product.entity';
import { CheckoutDto } from './dto/checkout.dto';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { paymentSummary } from '../payments/payment-summary';
import { Payment } from '../payments/entities/payment.entity';
import { OrderQueryDto } from './dto/order-query.dto';
import { PaginationQueryDto } from '../../common/http/dto/pagination-query.dto';
import { calculateCheckout } from './checkout-calculation';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DataSource) private readonly source: DataSource | null,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  private async owned(
    manager: EntityManager,
    userId: string,
    id: string,
    lock = false,
  ) {
    const query = manager
      .createQueryBuilder(Order, 'o')
      .where('o.id=:id AND o.userId=:userId', { id, userId });
    if (lock) query.setLock('pessimistic_write');
    const order = await query.getOne();
    if (!order) throw new ApiError('NOT_FOUND');
    return order;
  }

  private async summary(manager: EntityManager, order: Order) {
    const attempts = await manager.find(Payment, {
      where: { orderId: order.id },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const safe = (p?: Payment) => (p ? paymentSummary(p) : null);
    return {
      id: order.id,
      status: order.status,
      totalVnd: order.totalVnd,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      reservationExpiresAt: order.reservationExpiresAt,
      paymentSummary: {
        latestAttempt: safe(attempts[0]),
        successfulAttempt: safe(attempts.find((p) => p.status === 'SUCCESS')),
      },
    };
  }

  async list(userId: string, query: OrderQueryDto) {
    return transaction(this.source, async (manager) => {
      const direction = query.sort === 'createdAt' ? 'ASC' : 'DESC';
      const [orders, total] = await manager.findAndCount(Order, {
        where: { userId, ...(query.status ? { status: query.status } : {}) },
        order: { createdAt: direction, id: direction },
        skip: query.offset,
        take: query.limit,
      });
      const items = [];
      for (const order of orders)
        items.push(await this.summary(manager, order));
      return { items, offset: query.offset, limit: query.limit, total };
    });
  }

  private async detailData(manager: EntityManager, order: Order) {
    const lines = await manager.find(OrderItem, {
      where: { orderId: order.id },
      order: { productId: 'ASC' },
    });
    return {
      ...(await this.summary(manager, order)),
      shipping: {
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        addressLine: order.addressLine,
        provinceCity: order.provinceCity,
        ward: order.ward,
        district: order.district,
        postalCode: order.postalCode,
      },
      items: lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        productName: l.productName,
        unitPriceVnd: l.unitPriceVnd,
        quantity: l.quantity,
        lineTotalVnd: l.lineTotalVnd,
      })),
    };
  }

  private async historyData(
    manager: EntityManager,
    id: string,
    query: PaginationQueryDto,
  ) {
    const [rows, total] = await manager.findAndCount(OrderStatusHistory, {
      where: { orderId: id },
      order: { createdAt: 'ASC', id: 'ASC' },
      skip: query.offset,
      take: query.limit,
    });
    return {
      items: rows.map((h) => ({
        id: h.id,
        previousStatus: h.previousStatus,
        newStatus: h.newStatus,
        actorType: h.actorUserId ? 'USER' : 'SYSTEM',
        actorUserId: h.actorUserId,
        note: h.note,
        createdAt: h.createdAt,
      })),
      total,
      offset: query.offset,
      limit: query.limit,
    };
  }

  async detail(userId: string, id: string) {
    return transaction(this.source, async (manager) =>
      this.detailData(manager, await this.owned(manager, userId, id)),
    );
  }

  async history(userId: string, id: string, query: PaginationQueryDto) {
    return transaction(this.source, async (manager) => {
      await this.owned(manager, userId, id);
      return this.historyData(manager, id, query);
    });
  }

  async cancel(userId: string, id: string) {
    return transaction(this.source, async (manager) => {
      const order = await this.owned(manager, userId, id, true);
      if (order.status === 'CANCELLED')
        return { order: await this.summary(manager, order), changed: false };
      await manager
        .createQueryBuilder(Payment, 'p')
        .where('p.orderId=:id', { id })
        .orderBy('p.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const lines = await manager.find(OrderItem, {
        where: { orderId: id },
        order: { productId: 'ASC' },
      });
      const products: Product[] = [];
      for (const line of lines) {
        const product = await manager
          .createQueryBuilder(Product, 'p')
          .where('p.id=:id', { id: line.productId })
          .setLock('pessimistic_write')
          .getOne();
        if (!product) throw new ApiError('INTERNAL_ERROR');
        products.push(product);
      }
      // Wall clock after every potentially blocking lock, not transaction-start time.
      const now = await databaseNow(manager);
      if (
        order.status !== 'PENDING_PAYMENT' ||
        now >= order.reservationExpiresAt
      )
        throw new ApiError('ORDER_NOT_ELIGIBLE');
      const changed = await manager
        .createQueryBuilder()
        .update(Order)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where('id=:id AND status=:status AND reservation_expires_at > :now', {
          id,
          status: 'PENDING_PAYMENT',
          now,
        })
        .execute();
      if (changed.affected !== 1) throw new ApiError('ORDER_NOT_ELIGIBLE');
      await manager
        .createQueryBuilder()
        .update(Payment)
        .set({ status: 'EXPIRED', terminalAt: now })
        .where('order_id=:id AND status=:status', { id, status: 'PENDING' })
        .execute();
      for (const [index, line] of lines.entries()) {
        const stock =
          BigInt(products[index].stockAvailable) + BigInt(line.quantity);
        if (stock > 2147483647n) throw new ApiError('STOCK_RANGE_EXCEEDED');
        await manager.update(Product, line.productId, {
          stockAvailable: Number(stock),
          updatedAt: now,
        });
      }
      await manager.insert(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId: id,
          previousStatus: 'PENDING_PAYMENT',
          newStatus: 'CANCELLED',
          actorUserId: userId,
          note: null,
          createdAt: now,
        }),
      );
      order.status = 'CANCELLED';
      order.updatedAt = now;
      return { order: await this.summary(manager, order), changed: true };
    });
  }

  async checkout(customerId: string, dto: CheckoutDto) {
    const items = [...dto.items].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    );
    if (new Set(items.map((item) => item.productId)).size !== items.length)
      throw new ApiError('VALIDATION_FAILED');
    return transaction(this.source, async (manager) => {
      const products: Product[] = [];
      // One deterministic lock order regardless of request order; all later reads/writes use this manager.
      for (const item of items) {
        const product = await manager
          .createQueryBuilder(Product, 'p')
          .where('p.id=:id', { id: item.productId })
          .setLock('pessimistic_write')
          .getOne();
        if (!product) throw new ApiError('INSUFFICIENT_STOCK');
        products.push(product);
      }
      const calculated = calculateCheckout(items, products);
      const now = await databaseNow(manager);
      const deadline = new Date(
        now.getTime() +
          this.config.get('expiry', { infer: true }).orderReservationSeconds *
            1000,
      );
      for (const line of calculated.lines) {
        const result = await manager
          .createQueryBuilder()
          .update(Product)
          .set({
            stockAvailable: line.product.stockAvailable - line.quantity,
            updatedAt: now,
          })
          .where('id=:id', { id: line.product.id })
          .andWhere('stock_available >= :quantity', { quantity: line.quantity })
          .execute();
        if (result.affected !== 1) throw new ApiError('INSUFFICIENT_STOCK');
      }
      const shipping = dto.shipping;
      const order = manager.create(Order, {
        userId: customerId,
        status: 'PENDING_PAYMENT',
        totalVnd: calculated.totalVnd,
        recipientName: shipping.recipientName,
        recipientPhone: shipping.recipientPhone,
        addressLine: shipping.addressLine,
        provinceCity: shipping.provinceCity,
        ward: shipping.ward ?? null,
        district: shipping.district ?? null,
        postalCode: shipping.postalCode ?? null,
        createdAt: now,
        updatedAt: now,
        reservationExpiresAt: deadline,
      });
      await manager.insert(Order, order);
      for (const line of calculated.lines) {
        // lineTotalVnd is generated by PostgreSQL; never included in insert/update input.
        await manager.insert(
          OrderItem,
          manager.create(OrderItem, {
            orderId: order.id,
            productId: line.product.id,
            productName: line.product.name,
            unitPriceVnd: line.product.priceVnd,
            quantity: line.quantity,
          }),
        );
      }
      await manager.insert(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: null,
          newStatus: 'PENDING_PAYMENT',
          actorUserId: null,
          note: null,
          createdAt: now,
        }),
      );
      const savedItems = await manager.find(OrderItem, {
        where: { orderId: order.id },
        order: { productId: 'ASC' },
      });
      return {
        id: order.id,
        status: order.status,
        totalVnd: order.totalVnd,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        reservationExpiresAt: order.reservationExpiresAt,
        paymentSummary: { latestAttempt: null, successfulAttempt: null },
        shipping: {
          recipientName: order.recipientName,
          recipientPhone: order.recipientPhone,
          addressLine: order.addressLine,
          provinceCity: order.provinceCity,
          ward: order.ward,
          district: order.district,
          postalCode: order.postalCode,
        },
        items: savedItems.map((line) => ({
          id: line.id,
          productId: line.productId,
          productName: line.productName,
          unitPriceVnd: line.unitPriceVnd,
          quantity: line.quantity,
          lineTotalVnd: line.lineTotalVnd,
        })),
      };
    });
  }
}
