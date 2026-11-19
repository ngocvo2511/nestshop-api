import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** Query strings only: canonical unsigned decimal, bounded before any conversion. */
export function queryInteger(value: unknown): unknown {
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,6})$/.test(value))
    return Number(value);
  return value;
}

export class PaginationQueryDto {
  @ApiPropertyOptional({
    type: Number,
    default: 0,
    minimum: 0,
    maximum: 1000000,
    description:
      'Number of matching records to skip. Default: 0. For example, use offset=20 with limit=20 to get the second page. Maximum: 1000000.',
  })
  @Transform(({ value }: { value: unknown }) => queryInteger(value))
  @IsInt()
  @Min(0)
  @Max(1000000)
  offset = 0;

  @ApiPropertyOptional({
    type: Number,
    default: 20,
    minimum: 1,
    maximum: 100,
    description:
      'Maximum number of records to return on this page. Default: 20. Choose a whole number from 1 to 100.',
  })
  @Transform(({ value }: { value: unknown }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
