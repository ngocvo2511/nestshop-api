import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  Matches,
  ValidateBy,
} from 'class-validator';
import { RegisterDto } from '../auth/auth.dto';
import { PaginationQueryDto } from '../../common/http/dto/pagination-query.dto';
import {
  IsSafeText,
  trimmed,
} from '../../common/validation/contract-validators';
import { validPassword } from '../auth/password';
import { accountRoles, AccountRole } from '../auth/roles.guard';

export class CreateStaffDto extends RegisterDto {}

export class StaffStatusDto {
  @ApiProperty({
    description:
      'Set false to disable the staff account and revoke refresh tokens. Set true to enable it again.',
  })
  @IsBoolean()
  isActive!: boolean;
}

export class ProfilePatchDto {
  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true })
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

export class ChangePasswordDto {
  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    description: 'Your current password, entered exactly as used to log in.',
  })
  @ValidateBy({
    name: 'passwordPolicy',
    validator: { validate: validPassword },
  })
  currentPassword!: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    description:
      'Your new password. It must meet the password rules and differ from your current password.',
  })
  @ValidateBy({
    name: 'passwordPolicy',
    validator: { validate: validPassword },
  })
  newPassword!: string;
}

export class RoleQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: accountRoles })
  @IsOptional()
  @IsIn(accountRoles)
  role?: AccountRole;
}

export class RolePatchDto {
  @ApiProperty({ enum: accountRoles })
  @IsIn(accountRoles)
  role!: AccountRole;
}
