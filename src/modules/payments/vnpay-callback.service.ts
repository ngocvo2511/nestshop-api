import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ApiError } from '../../common/http/api-error';
import { Configuration } from '../../config/configuration';
import { databaseNow, transaction } from '../../database/transaction';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { Payment } from './entities/payment.entity';
import { PaymentNotification } from './entities/payment-notification.entity';
import {
  acknowledgements as ack,
  callbackDate,
  callbackResult,
  verifyCallback,
} from './vnpay-callback';

@Injectable()
export class VnpayCallbackService {
  constructor(
    @Inject(DataSource) private readonly source: DataSource | null,
    private readonly config: ConfigService<Configuration, true>,
  ) {}
  private verify(raw: string) {
    const settings = this.config.get('vnpay', { infer: true });
    if (settings.mode !== 'sandbox') throw new ApiError('PAYMENT_UNAVAILABLE');
    return { settings, verified: verifyCallback(raw, settings.hashSecret) };
  }
  browserReturn(raw: string) {
    const { settings, verified } = this.verify(raw);
    if (
      !verified.valid ||
      verified.fields.vnp_TmnCode !== settings.tmnCode ||
      BigInt(verified.fields.vnp_Amount) % 100n !== 0n ||
      (verified.fields.vnp_CurrCode !== undefined &&
        verified.fields.vnp_CurrCode !== 'VND')
    )
      throw new ApiError('VALIDATION_FAILED');
    return {
      reference: verified.fields.vnp_TxnRef,
      providerResponseCode: verified.fields.vnp_ResponseCode,
      settlementAuthoritative: false,
    };
  }
  async ipn(raw: string, correlationId: string) {
    const { settings, verified } = this.verify(raw);
    return transaction(this.source, async (manager) => {
      const fields = verified.valid ? verified.fields : null;
      let paymentId: string | null = null;
      const amount =
        fields && BigInt(fields.vnp_Amount) % 100n === 0n
          ? (BigInt(fields.vnp_Amount) / 100n).toString()
          : null;
      const receipt = async (outcome: string, safeDetail: string) => {
        await manager.insert(
          PaymentNotification,
          manager.create(PaymentNotification, {
            paymentId,
            correlationId,
            providerReference: fields?.vnp_TxnRef ?? null,
            providerTransactionReference: fields?.vnp_TransactionNo ?? null,
            signatureVerified: verified.valid,
            reportedAmountVnd: amount,
            reportedCurrency: fields ? (fields.vnp_CurrCode ?? 'VND') : null,
            responseCode: fields?.vnp_ResponseCode ?? null,
            transactionStatusCode: fields?.vnp_TransactionStatus ?? null,
            outcome,
            safeDetail,
            receivedAt: await databaseNow(manager),
          }),
        );
      };
      if (!fields) {
        await receipt('INVALID', 'INVALID_STRUCTURE_OR_SIGNATURE');
        return ack.invalid;
      }
      if (fields.vnp_TmnCode !== settings.tmnCode) {
        await receipt('UNKNOWN_REFERENCE', 'MERCHANT_CONTEXT');
        return ack.unknown;
      }
      // Resolve without acquiring a payment lock; mutations always acquire order first.
      const reference = await manager.findOne(Payment, {
        where: { providerReference: fields.vnp_TxnRef },
      });
      if (!reference) {
        await receipt('UNKNOWN_REFERENCE', 'UNKNOWN_REFERENCE');
        return ack.unknown;
      }
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .where('o.id=:id', { id: reference.orderId })
        .setLock('pessimistic_write')
        .getOne();
      const attempts = await manager
        .createQueryBuilder(Payment, 'p')
        .addSelect('p.paymentUrl')
        .where('p.orderId=:id', { id: reference.orderId })
        .orderBy('p.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const payment = attempts.find((p) => p.id === reference.id);
      if (!order || !payment) throw new ApiError('INTERNAL_ERROR');
      paymentId = payment.id;
      const now = await databaseNow(manager);
      if (
        !this.context(
          payment,
          settings.paymentUrl,
          settings.tmnCode,
          settings.apiVersion,
        )
      ) {
        await receipt('MISMATCH', 'ENVIRONMENT_CONTEXT');
        return ack.unknown;
      }
      if (
        amount === null ||
        amount !== payment.amountVnd ||
        amount !== order.totalVnd ||
        payment.currency !== 'VND' ||
        (fields.vnp_CurrCode !== undefined && fields.vnp_CurrCode !== 'VND')
      ) {
        await receipt('MISMATCH', 'AMOUNT_CURRENCY');
        return ack.mismatch;
      }
      if (
        fields.vnp_OrderInfo !==
        `Thanh toan don hang ${payment.providerReference}`
      ) {
        await receipt('MISMATCH', 'ORDER_DESCRIPTION');
        return ack.handled;
      }
      const result = callbackResult(fields);
      if (payment.status !== 'PENDING') {
        const exact =
          payment.status === result &&
          payment.providerTransactionReference === fields.vnp_TransactionNo &&
          payment.responseCode === fields.vnp_ResponseCode &&
          payment.transactionStatusCode === fields.vnp_TransactionStatus;
        if (exact) {
          await receipt('DUPLICATE', 'CANONICAL_RESULT');
          return ack.duplicate;
        }
        await receipt(
          payment.status === 'EXPIRED' ? 'LATE' : 'CONFLICT',
          'TERMINAL_ATTEMPT',
        );
        return ack.handled;
      }
      if (
        order.status !== 'PENDING_PAYMENT' ||
        now >= order.reservationExpiresAt ||
        now >= payment.expiresAt
      ) {
        await receipt('LATE', 'ORDER_OR_ATTEMPT_DEADLINE');
        return ack.handled;
      }
      const payDate = fields.vnp_PayDate
        ? callbackDate(fields.vnp_PayDate)
        : null;
      if (
        payDate &&
        (payDate.getTime() <
          Math.floor(payment.createdAt.getTime() / 1000) * 1000 ||
          payDate > now ||
          payDate >= payment.expiresAt ||
          payDate >= order.reservationExpiresAt)
      ) {
        await receipt('MISMATCH', 'PAY_DATE_CONTEXT');
        return ack.handled;
      }
      if (result === 'UNRESOLVED') {
        await receipt('CONFLICT', 'UNRESOLVED_RESULT');
        return ack.handled;
      }
      if (
        result === 'SUCCESS' &&
        attempts.some((p) => p.id !== payment.id && p.status === 'SUCCESS')
      ) {
        await receipt('CONFLICT', 'EXISTING_SUCCESS');
        return ack.handled;
      }
      const changed = await manager
        .createQueryBuilder()
        .update(Payment)
        .set({
          status: result,
          terminalAt: now,
          providerTransactionReference: fields.vnp_TransactionNo,
          responseCode: fields.vnp_ResponseCode,
          transactionStatusCode: fields.vnp_TransactionStatus,
        })
        .where("id=:id AND status='PENDING'", { id: payment.id })
        .execute();
      if (changed.affected !== 1) throw new ApiError('INTERNAL_ERROR');
      if (result === 'SUCCESS') {
        const updated = await manager
          .createQueryBuilder()
          .update(Order)
          .set({ status: 'PAID', updatedAt: now })
          .where(
            "id=:id AND status='PENDING_PAYMENT' AND reservation_expires_at > :now",
            { id: order.id, now },
          )
          .execute();
        if (updated.affected !== 1) throw new ApiError('INTERNAL_ERROR');
        await manager.insert(
          OrderStatusHistory,
          manager.create(OrderStatusHistory, {
            orderId: order.id,
            previousStatus: 'PENDING_PAYMENT',
            newStatus: 'PAID',
            actorUserId: null,
            note: null,
            createdAt: now,
          }),
        );
      }
      await receipt(
        result === 'SUCCESS' ? 'SETTLED' : 'FAILED',
        'APPLICABLE_RESULT',
      );
      return ack.handled;
    });
  }
  private context(
    payment: Payment,
    endpoint: string,
    merchant: string,
    version: string,
  ) {
    try {
      const url = new URL(payment.paymentUrl);
      return (
        payment.provider === 'VNPAY' &&
        url.origin + url.pathname === endpoint &&
        url.searchParams.get('vnp_TmnCode') === merchant &&
        url.searchParams.get('vnp_Version') === version &&
        url.searchParams.get('vnp_CurrCode') === 'VND' &&
        url.searchParams.get('vnp_TxnRef') === payment.providerReference &&
        url.searchParams.get('vnp_Amount') ===
          (BigInt(payment.amountVnd) * 100n).toString()
      );
    } catch {
      return false;
    }
  }
}
