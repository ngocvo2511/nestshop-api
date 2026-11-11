import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';
import { isUUID } from 'class-validator';
import { Configuration } from '../../config/configuration';
import { ApiError } from '../../common/http/api-error';

@Injectable()
export class AccessTokenService {
  constructor(private readonly config: ConfigService<Configuration, true>) {}

  async sign(user: { id: string; role: string }, now: Date): Promise<string> {
    const cfg = this.config.get('jwt', { infer: true });
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({ role: user.role, tokenType: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(cfg.issuer)
      .setAudience(cfg.audience)
      .setIssuedAt(iat)
      .setExpirationTime(iat + cfg.accessTtlSeconds)
      .sign(new TextEncoder().encode(cfg.accessSecret));
  }

  async verify(token: string): Promise<{ sub: string; role: string }> {
    const cfg = this.config.get('jwt', { infer: true });
    try {
      const { payload, protectedHeader } = await jwtVerify(
        token,
        new TextEncoder().encode(cfg.accessSecret),
        {
          algorithms: ['HS256'],
          issuer: cfg.issuer,
          audience: cfg.audience,
          requiredClaims: ['sub', 'role', 'tokenType', 'iat', 'exp'],
        },
      );
      if (
        protectedHeader.typ !== 'JWT' ||
        payload.tokenType !== 'access' ||
        typeof payload.sub !== 'string' ||
        !isUUID(payload.sub, '4') ||
        typeof payload.role !== 'string' ||
        !['CUSTOMER', 'STAFF', 'ADMIN'].includes(payload.role) ||
        !Number.isInteger(payload.iat) ||
        !Number.isInteger(payload.exp) ||
        payload.iat! > Math.floor(Date.now() / 1000) ||
        payload.exp! <= payload.iat!
      )
        throw new Error();
      return { sub: payload.sub, role: payload.role };
    } catch {
      throw new ApiError('UNAUTHORIZED');
    }
  }
}
