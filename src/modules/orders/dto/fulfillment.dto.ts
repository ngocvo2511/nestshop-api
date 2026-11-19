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
  @ApiPropertyOptional({
    enum: fulfillmentStatuses,
    default: 'PAID',
    description:
      'PAID = paid and awaiting preparation (default); PROCESSING = being prepared; SHIPPED = sent to the customer; COMPLETED = finished.',
  })
  @IsIn(fulfillmentStatuses)
  status = 'PAID';
}
export class AdvanceOrderDto {
  @ApiProperty({
    enum: ['PROCESSING', 'SHIPPED', 'COMPLETED'],
    description:
      'Next order status. Follow PAID -> PROCESSING -> SHIPPED -> COMPLETED, one step at a time.',
  })
  @IsIn(['PROCESSING', 'SHIPPED', 'COMPLETED'])
  status!: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 1000,
    nullable: true,
    description:
      'Optional note saved with this status change. Use 1 to 1000 characters, or null for no note.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(1000)
  note?: string | null;
}
