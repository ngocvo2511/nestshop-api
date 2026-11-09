import { Payment } from './entities/payment.entity';
/** Explicit public allowlist; never spread a payment entity into a response. */
export function paymentSummary(p: Payment) {
  return {
    id: p.id,
    provider: p.provider,
    providerReference: p.providerReference,
    status: p.status,
    amountVnd: p.amountVnd,
    currency: p.currency,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    terminalAt: p.terminalAt,
  };
}
