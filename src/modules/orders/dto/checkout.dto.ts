import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsInt,
  IsObject,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ShippingDto } from './shipping.dto';

export class CheckoutItemDto {
  @ApiProperty({
    format: 'uuid',
    description: 'UUIDv4 normalized to lowercase; duplicates are rejected.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  productId!: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: 2147483647,
    description:
      'JSON integer; no string coercion; additionally bounded by locked available stock.',
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}

export class CheckoutDto {
  @ApiProperty({ type: [CheckoutItemDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((item: CheckoutItemDto | null) => item?.productId)
  @IsObject({ each: true })
  @Type(() => CheckoutItemDto)
  @ValidateNested({ each: true })
  items!: CheckoutItemDto[];

  @ApiProperty({
    type: ShippingDto,
    description:
      'Inline shipping snapshot; no cart/address ID required or accepted.',
  })
  @IsDefined()
  @IsObject()
  @Type(() => ShippingDto)
  @ValidateNested()
  shipping!: ShippingDto;
}
