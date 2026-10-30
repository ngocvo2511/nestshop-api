import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Patch,
  Post,
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
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from '../auth/access-token.guard';
import { AuthService } from '../auth/auth.service';
import { ProfilePatchDto, ChangePasswordDto } from './users.dto';
import { UsersService } from './users.service';
import { AccountErrors, profileSchema } from './users.openapi';

@ApiTags('own account')
@ApiBearerAuth()
@AccountErrors()
@UseGuards(AccessTokenGuard)
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read own profile',
    description:
      'All authenticated roles. Identity only from verified JWT sub. No arbitrary userId, query or body.',
  })
  @ApiResponse({ status: 200, schema: profileSchema })
  profile(
    @Req() request: AuthenticatedRequest,
    @Query(EmptyBodyPipe) query: Record<string, never>,
    @Body(EmptyBodyPipe) body: Record<string, never>,
  ) {
    void query;
    void body;
    return this.users.profile(request.identity!.sub);
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Update own full name/phone',
    description:
      'Nonempty subset of fullName/phoneNumber; null clears. Reject role/email/active/password/hash/avatar/userId. No avatar or shipping mutation.',
  })
  @ApiResponse({ status: 200, schema: profileSchema })
  patch(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ProfilePatchDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.users.updateProfile(request.identity!.sub, dto);
  }

  @Post('password')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Change own password and revoke every refresh family atomically',
    description:
      'Verify current password under the shared user lock. Different policy-valid replacement required. PASSWORD_CHANGE revocation; prior LOGOUT/PASSWORD_CHANGE timestamps/reasons remain intact. Existing access JWTs remain stateless until expiry; no immediate access revocation.',
  })
  @ApiResponse({
    status: 204,
    description: 'Password and refresh revocation committed. No body.',
  })
  password(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.auth.changePassword(request.identity!.sub, dto);
  }
}
