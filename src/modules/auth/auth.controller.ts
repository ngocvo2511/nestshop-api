import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmptyBodyPipe } from '../../common/http/empty-body.pipe';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import { authSuccessSchema } from './auth.openapi';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Log out',
    description:
      'Send the refreshToken in the JSON body. An access token is not required. This ends the session linked to that refresh token. An unknown, expired or already revoked token also returns 204. Existing access tokens remain usable until they expire, as long as the account is active.',
  })
  @ApiResponse({
    status: 204,
    description: 'Logged out. The response has no body.',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED: Check the request fields and their formats.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  logout(
    @Body() dto: RefreshDto,
    @Query(EmptyBodyPipe) query: Record<string, never>,
  ) {
    void query;
    return this.auth.logout(dto.refreshToken);
  }

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Create a customer account',
    description:
      'Creates an active CUSTOMER account. You must log in separately to get tokens. Email addresses are trimmed and converted to lowercase. Do not send role or isActive.',
  })
  @ApiResponse({ status: 201, schema: authSuccessSchema(false) })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED: Check the request fields and their formats.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 409,
    description: 'EMAIL_IN_USE: An account with this email already exists.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  register(
    @Body() dto: RegisterDto,
    @Query(EmptyBodyPipe) _query: Record<string, never>,
  ) {
    void _query;
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Log in',
    description:
      'Send your email and password. Returns access and refresh tokens, their expiry information, and basic user details. An incorrect password, unknown email or disabled account returns INVALID_CREDENTIALS.',
  })
  @ApiResponse({ status: 200, schema: authSuccessSchema(true) })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED: Check the email and password formats.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 401,
    description:
      'INVALID_CREDENTIALS: The email or password is incorrect, or the account is disabled.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  login(
    @Body() dto: LoginDto,
    @Query(EmptyBodyPipe) _query: Record<string, never>,
  ) {
    void _query;
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get new tokens',
    description:
      'Send a valid refreshToken to receive a new access token and refresh token. This response does not include a user profile; use GET /api/v1/users/me for that. Send each refresh token only once. Reusing a token that was already exchanged ends this session and returns REFRESH_REPLAY. Avoid sending multiple refresh requests at the same time. Tokens revoked by logout or a password change return INVALID_REFRESH_TOKEN.',
  })
  @ApiResponse({ status: 200, schema: authSuccessSchema(true, false) })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED: The refreshToken format is invalid.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 401,
    description:
      'INVALID_REFRESH_TOKEN: The token is invalid, expired or revoked. REFRESH_REPLAY: This token was already used; log in again.',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  refresh(
    @Body() dto: RefreshDto,
    @Query(EmptyBodyPipe) _query: Record<string, never>,
  ) {
    void _query;
    return this.auth.refresh(dto.refreshToken);
  }
}
