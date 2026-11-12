import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ApiError } from '../../common/http/api-error';
import { Configuration } from '../../config/configuration';
import { databaseNow, transaction } from '../../database/transaction';
import { Order } from '../orders/entities/order.entity';
import { Payment } from './entities/payment.entity';
import { paymentSummary } from './payment-summary';
import { VnpayAdapter } from './vnpay.adapter';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DataSource) private readonly source: DataSource | null,
    private readonly config: ConfigService<Configuration, true>,
    private readonly adapter: VnpayAdapter,
  ) {}
  async initiate(userId: string, id: string, ipAddress: string) {
    return transaction(this.source, async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .where('o.id=:id AND o.userId=:userId', { id, userId })
        .setLock('pessimistic_write')
        .getOne();
      if (!order) throw new ApiError('NOT_FOUND');
      const attempts = await manager
        .createQueryBuilder(Payment, 'p')
        .where('p.orderId=:id', { id })
        .orderBy('p.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const now = await databaseNow(manager);
      if (
        order.status !== 'PENDING_PAYMENT' ||
        now >= order.reservationExpiresAt
      )
        throw new ApiError('ORDER_NOT_ELIGIBLE');
      // A local target timestamp never proves finality. Until provider reuse is verified,
      // every unresolved PENDING attempt conflicts; it is never expired/replaced here.
      if (attempts.some((p) => p.status !== 'FAILED' && p.status !== 'EXPIRED'))
        throw new ApiError('PAYMENT_UNRESOLVED');
      if (this.config.get('vnpay', { infer: true }).mode !== 'sandbox')
        throw new ApiError('PAYMENT_UNAVAILABLE');
      const expiresAt = new Date(
        now.getTime() +
          this.config.get('expiry', { infer: true }).paymentAttemptSeconds *
            1000,
      );
      const reference = randomUUID().replaceAll('-', '');
      let paymentUrl: string;
      try {
        paymentUrl = this.adapter.create({
          reference,
          amountVnd: order.totalVnd,
          createdAt: now,
          expiresAt,
          ipAddress,
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'MONEY_LIMIT_EXCEEDED')
          throw error;
        throw new ApiError('PAYMENT_UNAVAILABLE');
      }
      const payment = manager.create(Payment, {
        orderId: id,
        provider: 'VNPAY',
        providerReference: reference,
        status: 'PENDING',
        amountVnd: order.totalVnd,
        currency: 'VND',
        paymentUrl,
        createdAt: now,
        expiresAt,
        terminalAt: null,
      });
      await manager.insert(Payment, payment);
      return { attempt: paymentSummary(payment), paymentUrl, reused: false };
    });
  }
}
