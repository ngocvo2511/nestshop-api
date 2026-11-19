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
      'Search text in the product name or description. Letter case does not matter. Characters such as % and _ are treated as normal text.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(100)
  q?: string;

  @ApiPropertyOptional({
    type: String,
    pattern: '^[1-9][0-9]{0,18}$',
    description:
      'Minimum price in whole VND, including this amount. Send a string, such as "100000". It must not exceed maxPriceVnd. Maximum: 9223372036854775807.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsVndAmount()
  minPriceVnd?: string;

  @ApiPropertyOptional({
    type: String,
    pattern: '^[1-9][0-9]{0,18}$',
    description:
      'Maximum price in whole VND, including this amount. Send a string, such as "500000". Maximum: 9223372036854775807.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsVndAmount()
  maxPriceVnd?: string;

  @ApiPropertyOptional({
    enum: productSorts,
    default: 'name',
    description:
      'Sort by name, priceVnd or createdAt. Add a minus sign for descending order, such as -priceVnd for highest price first. Default: name, A to Z. Ties are ordered by product ID in the same direction.',
  })
  @IsIn(productSorts)
  sort: ProductSort = 'name';
}

export class AdminProductQueryDto extends ProductQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'active', 'inactive'],
    default: 'all',
    description:
      'Choose all products, only active products, or only inactive products. Default: all. This filter is for the ADMIN list.',
  })
  @IsIn(['all', 'active', 'inactive'])
  status: 'all' | 'active' | 'inactive' = 'all';
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
      'Price in whole VND. Send a positive integer as a string, such as "350000", not a JSON number. Maximum: 9223372036854775807.',
  })
  @IsVndAmount()
  priceVnd!: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: MAX_DB_INTEGER,
    description:
      'Starting stock when creating the product. Send a whole number, such as 10, not a string such as "10".',
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
      'Price in whole VND. Send a positive integer as a string, such as "350000". Maximum: 9223372036854775807.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsVndAmount()
  priceVnd?: string;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
