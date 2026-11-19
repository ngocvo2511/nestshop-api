import { ApiErrors } from '../../common/http/api-errors.decorator';
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
import { profileSchema } from './users.openapi';

@ApiTags('own account')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiErrors('VALIDATION_FAILED', 'UNAUTHORIZED', 'NOT_FOUND')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'View my profile',
    description:
      'Available to any logged-in user. Returns the profile linked to your access token. Do not send a user ID, request body or query parameters.',
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
  @ApiErrors('VALIDATION_FAILED', 'EMPTY_UPDATE', 'UNAUTHORIZED', 'NOT_FOUND')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Send fullName, phoneNumber, or both. Use null to clear either field. Email, role, account status and password cannot be changed here. Use the password endpoint to change your password.',
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
  @ApiErrors('VALIDATION_FAILED', 'INVALID_CURRENT_PASSWORD', 'UNAUTHORIZED')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Change my password',
    description:
      'Send currentPassword and a different newPassword that meets the password rules. A successful change revokes all your refresh sessions. Existing access tokens remain valid until they expire, as long as your account is active.',
  })
  @ApiResponse({
    status: 204,
    description:
      'Password changed and refresh sessions revoked. The response has no body.',
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
