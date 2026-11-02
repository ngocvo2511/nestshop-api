import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/http/dto/pagination-query.dto';
import {
  IsSafeText,
  IsVndAmount,
  MAX_DB_INTEGER,
  trimmed,
} from '../../common/validation/contract-validators';

export const productSorts = [
  'name',
  '-name',
  'priceVnd',
  '-priceVnd',
  'createdAt',
  '-createdAt',
] as const;
export type ProductSort = (typeof productSorts)[number];

export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'Case-insensitive literal substring in name/description. SQL wildcards are escaped.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(100)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    pattern: '^[1-9][0-9]{0,18}$',
    description:
      'Inclusive integer VND; at most 9223372036854775807. Must not exceed maxPriceVnd.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsVndAmount()
  minPriceVnd?: string;

  @ApiPropertyOptional({
    type: String,
    pattern: '^[1-9][0-9]{0,18}$',
    description: 'Inclusive integer VND; at most 9223372036854775807.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsVndAmount()
  maxPriceVnd?: string;

  @ApiPropertyOptional({
    enum: productSorts,
    default: 'name',
    description: 'Fixed allowlist; id tie-break follows the same direction.',
  })
  @IsIn(productSorts)
  sort: ProductSort = 'name';
}

export class CreateProductDto {
  @ApiProperty({ minLength: 1, maxLength: 250 })
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(250)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10000 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(10000)
  description?: string | null;

  @ApiProperty({
    type: String,
    pattern: '^[1-9][0-9]{0,18}$',
    description:
      'Positive integer VND decimal string, maximum 9223372036854775807; JSON numbers are rejected.',
  })
  @IsVndAmount()
  priceVnd!: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: MAX_DB_INTEGER,
    description: 'Create-only JSON integer stock. No string coercion.',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_DB_INTEGER)
  initialStock!: number;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsBoolean()
  isActive = true;
}

export class PatchProductDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 250 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(250)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 10000 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(10000)
  description?: string | null;

  @ApiPropertyOptional({
    type: String,
    pattern: '^[1-9][0-9]{0,18}$',
    description:
      'Positive integer VND decimal string, maximum 9223372036854775807.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsVndAmount()
  priceVnd?: string;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
