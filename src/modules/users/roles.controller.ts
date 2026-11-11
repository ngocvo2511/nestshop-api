import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import { UuidParamDto } from '../../common/http/dto/uuid-param.dto';
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from '../auth/access-token.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { RoleQueryDto, RolePatchDto } from './users.dto';
import { UsersService } from './users.service';
import {
  AccountErrors,
  rolesListSchema,
  roleChangeSchema,
} from './users.openapi';

@ApiTags('admin roles')
@ApiBearerAuth()
@AccountErrors()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/users')
export class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get('roles')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ADMIN role assignment list',
    description:
      'Allowlisted pagination and optional role filter. Fixed createdAt DESC, id DESC. Safe identity/role fields only; no credentials.',
  })
  @ApiResponse({ status: 200, schema: rolesListSchema })
  list(
    @Query() query: RoleQueryDto,
    @Body(EmptyBodyPipe) body: Record<string, never>,
  ) {
    void body;
    return this.users.roles(query);
  }

  @Patch(':id/role')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ADMIN audited role assignment',
    description:
      'Target locked; role and audit commit atomically. Same role returns changed:false,auditId:null and no audit/write. Actor comes only from verified JWT. Existing JWT role claims stay authoritative until expiry, including a demoted Admin; new login/refresh reads current role. No last-admin/deletion/deactivation policy added.',
  })
  @ApiResponse({ status: 200, schema: roleChangeSchema })
  change(
    @Req() request: AuthenticatedRequest,
    @Param() params: UuidParamDto,
    @Body() dto: RolePatchDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.users.changeRole(request.identity!.sub, params.id, dto.role);
  }
}
