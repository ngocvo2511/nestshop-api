import { ApiErrors } from '../../common/http/api-errors.decorator';
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
import { rolesListSchema, roleChangeSchema } from './users.openapi';

@ApiTags('admin roles')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/users')
export class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get('roles')
  @ApiErrors('VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List user roles (ADMIN)',
    description:
      'Lists user IDs, emails, roles and active status. Optionally filter by role. Use offset and limit for pagination. Newest accounts appear first; accounts created at the same time are ordered by ID, descending. Passwords are never returned.',
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
  @ApiErrors('VALIDATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Change a user role (ADMIN)',
    description:
      'Set role to CUSTOMER, STAFF or ADMIN. Each actual change is saved in the role history. Sending the current role returns changed=false and auditId=null. Existing access tokens keep their previous role until they expire; login and refresh use the new role. There is no protection against removing the last ADMIN role. To disable a STAFF account instead, use PATCH /api/v1/admin/staff/:id/status.',
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
