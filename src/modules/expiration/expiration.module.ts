import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ExpirationScanner } from './expiration.scanner';

@Module({ imports: [OrdersModule], providers: [ExpirationScanner] })
export class ExpirationModule {}
