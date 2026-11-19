import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  Matches,
  MaxLength,
  ValidateBy,
} from 'class-validator';
import {
  IsSafeText,
  trimmed,
} from '../../common/validation/contract-validators';
import { validPassword } from './password';

export class LoginDto {
  @ApiProperty({ maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    description:
      'Use 12 to 128 characters. Do not add spaces at the start or end, line breaks or control characters. Passwords are used exactly as entered.',
  })
  @ValidateBy({
    name: 'passwordPolicy',
    validator: { validate: validPassword },
  })
  password!: string;
}

export class RegisterDto extends LoginDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @IsSafeText(200)
  fullName?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: '^\\+?[0-9]{8,15}$',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimmed(value))
  @Matches(/^\+?[0-9]{8,15}$/)
  phoneNumber?: string | null;
}

export class RefreshDto {
  @ApiProperty({
    minLength: 43,
    maxLength: 43,
    description:
      'Copy the refreshToken returned by login or refresh. Send it unchanged in the JSON body.',
  })
  @Matches(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
  refreshToken!: string;
}
