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
  @ApiPropertyOptional({ enum: orderStatuses })
  @IsOptional()
  @IsIn(orderStatuses)
  status?: string;
  @ApiPropertyOptional({
    enum: ['createdAt', '-createdAt'],
    default: '-createdAt',
  })
  @IsIn(['createdAt', '-createdAt'])
  sort = '-createdAt';
}
