import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';
import {
  IsSafeText,
  trimmed,
} from '../../../common/validation/contract-validators';

export class ShippingDto {
  @ApiProperty({ maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(200)
  recipientName!: string;

  @ApiProperty({ maxLength: 32, pattern: '^\\+?[0-9]{8,15}$' })
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @Matches(/^\+?[0-9]{8,15}$/)
  recipientPhone!: string;

  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(500)
  addressLine!: string;

  @ApiPropertyOptional({ type: String, maxLength: 150, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(150)
  ward?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 150, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(150)
  district?: string | null;

  @ApiProperty({ maxLength: 150 })
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(150)
  provinceCity!: string;

  @ApiPropertyOptional({ type: String, maxLength: 20, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(20)
  postalCode?: string | null;
}
