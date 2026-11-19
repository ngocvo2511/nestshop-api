import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min, NotEquals } from 'class-validator';
import {
  IsSafeText,
  trimmed,
} from '../../common/validation/contract-validators';

export class StockAdjustmentDto {
  @ApiProperty({
    type: Number,
    minimum: -2147483648,
    maximum: 2147483647,
    description:
      'How many units to add or remove. Use a whole number other than zero: 5 adds five units; -2 removes two. This is not the new total stock.',
  })
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  @NotEquals(0)
  quantityDelta!: number;

  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(1000)
  reason!: string;
}
