import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenService } from './access-token.service';
import { AccessTokenGuard } from './access-token.guard';
import { RolesGuard } from './roles.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AccessTokenService, AccessTokenGuard, RolesGuard],
  exports: [AuthService, AccessTokenService, AccessTokenGuard, RolesGuard],
})
export class AuthModule {}
