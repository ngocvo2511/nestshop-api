import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { VnpayCallbackController } from './vnpay-callback.controller';
import { VnpayCallbackService } from './vnpay-callback.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { VnpayAdapter } from './vnpay.adapter';
@Module({
  imports: [AuthModule],
  controllers: [
    PaymentsController,
    VnpayCallbackController,
    AdminPaymentsController,
  ],
  providers: [
    PaymentsService,
    VnpayAdapter,
    VnpayCallbackService,
    PaymentReconciliationService,
  ],
})
export class PaymentsModule {}
