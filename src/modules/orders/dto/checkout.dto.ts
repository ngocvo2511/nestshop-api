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
    description:
      'Product ID in UUID v4 format. Include each product only once in the order.',
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
      'Number of units to buy. Send a whole number, such as 2, not a string such as "2". It cannot exceed available stock.',
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
      'Enter the delivery details here. They are saved with this order. Do not send a cart ID or a saved address ID.',
  })
  @IsDefined()
  @IsObject()
  @Type(() => ShippingDto)
  @ValidateNested()
  shipping!: ShippingDto;
}
