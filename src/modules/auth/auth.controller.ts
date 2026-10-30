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
    summary: 'Revoke the supplied refresh family idempotently',
    description:
      'JSON refreshToken only; no access JWT required. Unknown/expired/already revoked tokens return 204. A consumed predecessor can revoke its live family. Preserve prior revocation metadata; existing access JWTs remain valid until expiry.',
  })
  @ApiResponse({
    status: 204,
    description:
      'Family revoked with LOGOUT, or already unavailable. No response body.',
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED',
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
    summary: 'Create an active CUSTOMER; no automatic session',
    description:
      'Email is trimmed/lowercased. Rejects protected/unknown fields. Never returns hashes.',
  })
  @ApiResponse({ status: 201, schema: authSuccessSchema(false) })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 409,
    description: 'EMAIL_IN_USE',
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
    summary: 'Sign in an active account',
    description:
      'Generic INVALID_CREDENTIALS for unknown/inactive account or incorrect password. Lifetimes from environment; access JWT HS256, opaque refresh JSON transport.',
  })
  @ApiResponse({ status: 200, schema: authSuccessSchema(true) })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 401,
    description: 'INVALID_CREDENTIALS',
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
    summary: 'Rotate a refresh token atomically',
    description:
      'Consumes before successor insert. Consumed replay commits whole-family revocation before 401 REFRESH_REPLAY. Concurrent loser can revoke winner successor; no grace period. LOGOUT/PASSWORD_CHANGE revocation remains ordinary INVALID_REFRESH_TOKEN. Stateless access JWTs remain valid until expiry.',
  })
  @ApiResponse({ status: 200, schema: authSuccessSchema(true) })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED',
    schema: { $ref: '#/components/schemas/ErrorEnvelope' },
  })
  @ApiResponse({
    status: 401,
    description: 'INVALID_REFRESH_TOKEN / REFRESH_REPLAY',
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
