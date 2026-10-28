import { HttpException } from '@nestjs/common';

export const errorCatalog = {
  VALIDATION_FAILED: [400, 'Request validation failed'],
  BAD_REQUEST: [400, 'Invalid request'],
  MALFORMED_JSON: [400, 'Malformed JSON body'],
  UNAUTHORIZED: [401, 'Authentication required or invalid credentials'],
  FORBIDDEN: [403, 'Access denied'],
  NOT_FOUND: [404, 'Resource not found'],
  CONFLICT: [409, 'Request conflicts with current state'],
  PAYLOAD_TOO_LARGE: [413, 'Request payload is too large'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'Unsupported media type'],
  INTERNAL_ERROR: [500, 'An unexpected error occurred'],
  SERVICE_UNAVAILABLE: [503, 'Service temporarily unavailable'],
  EMAIL_IN_USE: [409, 'Email is already registered'],
  INVALID_CREDENTIALS: [401, 'Invalid credentials'],
  INVALID_REFRESH_TOKEN: [401, 'Refresh token is invalid or expired'],
  REFRESH_REPLAY: [401, 'Session revoked; sign in again'],
  INVALID_CURRENT_PASSWORD: [400, 'Current password is incorrect'],
  EMPTY_UPDATE: [400, 'At least one writable field is required'],
  INSUFFICIENT_STOCK: [409, 'Requested stock is unavailable'],
  STOCK_RANGE_EXCEEDED: [409, 'Resulting stock is outside the allowed range'],
  MONEY_LIMIT_EXCEEDED: [400, 'Amount exceeds the supported limit'],
  ORDER_NOT_ELIGIBLE: [409, 'Order is no longer eligible for this operation'],
  INVALID_STATE_TRANSITION: [409, 'Order status transition is not allowed'],
  PAYMENT_UNRESOLVED: [409, 'An existing payment attempt requires resolution'],
  PAYMENT_UNAVAILABLE: [503, 'Payment initiation is unavailable'],
  UPLOAD_INVALID_TYPE: [415, 'Image content type is not supported'],
  UPLOAD_TOO_LARGE: [413, 'Image exceeds the configured size limit'],
} as const;

export type ErrorCode = keyof typeof errorCatalog;
export interface ValidationDetail {
  field: string;
  rules: string[];
}

/** Only catalogued, value-free public errors may supply a client-facing message. */
export class ApiError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    public readonly details?: ValidationDetail[],
  ) {
    super(errorCatalog[code][1], errorCatalog[code][0]);
  }
}
