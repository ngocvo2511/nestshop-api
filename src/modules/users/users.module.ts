import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';
import { UsersService } from './users.service';
import { StaffAccountsController } from './staff-accounts.controller';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, RolesController, StaffAccountsController],
  providers: [UsersService],
})
export class UsersModule {}
