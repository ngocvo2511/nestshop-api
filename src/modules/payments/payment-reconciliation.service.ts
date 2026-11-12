import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ApiError } from '../../common/http/api-error';
import { PaginationQueryDto } from '../../common/http/dto/pagination-query.dto';
import { transaction } from '../../database/transaction';
import { Payment } from './entities/payment.entity';
import { PaymentNotification } from './entities/payment-notification.entity';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { paymentSummary } from './payment-summary';

@Injectable()
export class PaymentReconciliationService {
  constructor(@Inject(DataSource) private readonly source: DataSource | null) {}
  private safe(p: Payment) {
    return {
      ...paymentSummary(p),
      orderId: p.orderId,
      providerTransactionReference: p.providerTransactionReference,
      responseCode: p.responseCode,
      transactionStatusCode: p.transactionStatusCode,
    };
  }
  private async payment(manager: EntityManager, id: string) {
    const p = await manager.findOne(Payment, { where: { id } });
    if (!p) throw new ApiError('NOT_FOUND');
    return p;
  }
  list(query: PaymentQueryDto) {
    return transaction(this.source, async (manager) => {
      const [rows, total] = await manager.findAndCount(Payment, {
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.orderId ? { orderId: query.orderId } : {}),
          ...(query.providerReference
            ? { providerReference: query.providerReference }
            : {}),
        },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: query.offset,
        take: query.limit,
      });
      return {
        items: rows.map((p) => this.safe(p)),
        total,
        offset: query.offset,
        limit: query.limit,
      };
    });
  }
  detail(id: string) {
    return transaction(this.source, async (manager) =>
      this.safe(await this.payment(manager, id)),
    );
  }
  notifications(id: string, query: PaginationQueryDto) {
    return transaction(this.source, async (manager) => {
      await this.payment(manager, id);
      const [rows, total] = await manager.findAndCount(PaymentNotification, {
        where: { paymentId: id },
        order: { receivedAt: 'ASC', id: 'ASC' },
        skip: query.offset,
        take: query.limit,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          paymentId: r.paymentId,
          correlationId: r.correlationId,
          providerReference: r.providerReference,
          providerTransactionReference: r.providerTransactionReference,
          signatureVerified: r.signatureVerified,
          reportedAmountVnd: r.reportedAmountVnd,
          reportedCurrency: r.reportedCurrency,
          responseCode: r.responseCode,
          transactionStatusCode: r.transactionStatusCode,
          outcome: r.outcome,
          safeDetail: r.safeDetail,
          receivedAt: r.receivedAt,
        })),
        total,
        offset: query.offset,
        limit: query.limit,
      };
    });
  }
}
