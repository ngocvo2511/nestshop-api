import {
  Body,
  Controller,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-errors.decorator';
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import { UuidParamDto } from '../../common/http/dto/uuid-param.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CreateStaffDto, StaffStatusDto } from './users.dto';
import { UsersService } from './users.service';
import { profileSchema } from './users.openapi';

@ApiTags('admin staff accounts')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/staff')
export class StaffAccountsController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Create a staff account (ADMIN)',
    description:
      'Creates an active STAFF account. Send email, password and optional fullName and phoneNumber. Do not send role or isActive. This does not log the new user in. To list staff, use GET /api/v1/admin/users/roles?role=STAFF.',
  })
  @ApiErrors('VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'EMAIL_IN_USE')
  @ApiResponse({ status: 201, schema: profileSchema })
  create(
    @Body() dto: CreateStaffDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.users.createStaff(dto);
  }

  @Patch(':id/status')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Disable or enable a staff account (ADMIN)',
    description:
      'Send isActive=false to disable a STAFF account, or true to enable it. Disabling blocks subsequent authenticated requests, including old access tokens, and revokes refresh tokens. Requests already in progress may finish. Enabling does not restore refresh tokens, but old access tokens can work again if they have not expired. Account details and history are kept. This endpoint cannot disable CUSTOMER or ADMIN accounts.',
  })
  @ApiErrors('VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND')
  @ApiResponse({ status: 200, schema: profileSchema })
  status(
    @Param() params: UuidParamDto,
    @Body() dto: StaffStatusDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.users.setStaffActive(params.id, dto.isActive);
  }
}
