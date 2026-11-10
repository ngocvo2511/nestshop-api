import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/dto/pagination-query.dto';
import {
  IsSafeText,
  trimmed,
} from '../../../common/validation/contract-validators';

export const fulfillmentStatuses = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'COMPLETED',
] as const;
export class FulfillmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: fulfillmentStatuses, default: 'PAID' })
  @IsIn(fulfillmentStatuses)
  status = 'PAID';
}
export class AdvanceOrderDto {
  @ApiProperty({ enum: ['PROCESSING', 'SHIPPED', 'COMPLETED'] })
  @IsIn(['PROCESSING', 'SHIPPED', 'COMPLETED'])
  status!: string;

  @ApiPropertyOptional({ type: String, maxLength: 1000, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(1000)
  note?: string | null;
}
