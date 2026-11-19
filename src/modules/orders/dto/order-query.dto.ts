import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/dto/pagination-query.dto';
export const orderStatuses = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
];
export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: orderStatuses,
    description:
      'Filter by order status. PENDING_PAYMENT = awaiting payment; PAID = paid; PROCESSING = being prepared; SHIPPED = sent; COMPLETED = finished; CANCELLED = cancelled; EXPIRED = reservation expired. Omit to include all statuses.',
  })
  @IsOptional()
  @IsIn(orderStatuses)
  status?: string;
  @ApiPropertyOptional({
    enum: ['createdAt', '-createdAt'],
    default: '-createdAt',
    description:
      'Use -createdAt for newest orders first (default), or createdAt for oldest first.',
  })
  @IsIn(['createdAt', '-createdAt'])
  sort = '-createdAt';
}
