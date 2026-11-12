import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/http/dto/pagination-query.dto';
export class PaymentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'] })
  @IsOptional()
  @IsIn(['PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'])
  status?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  orderId?: string;
  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Exact bounded ASCII reference, parameterized filter',
  })
  @IsOptional()
  @Matches(/^[\x20-\x7E]{1,100}$/)
  providerReference?: string;
}
