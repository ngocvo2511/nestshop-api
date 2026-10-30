import 'reflect-metadata';
import {
  Controller,
  Get,
  INestApplication,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, decodeJwt } from 'jose';
import { DataSource, QueryFailedError } from 'typeorm';
import { AuthService } from './auth.service';
import { Configuration } from '../../config/configuration';
import { AccessTokenService } from './access-token.service';
import { AccessTokenGuard, AuthenticatedRequest } from './access-token.guard';
import { AuthModule } from './auth.module';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { hashPassword, validPassword, verifyPassword } from './password';
import {
  configureHttp,
  initializeHttp,
} from '../../common/http/configure-http';
import { SafeJsonLogger } from '../../common/logging/safe-json.logger';
import { configureOpenApi } from '../../openapi';

@Controller('identity-probe')
class IdentityProbe {
  @Get()
  @UseGuards(AccessTokenGuard)
  identity(@Req() req: AuthenticatedRequest) {
    return req.identity;
  }
}

describe('auth password security', () => {
  it.each([
    'short',
    'a'.repeat(129),
    ' leading spaces',
    'trailing spaces ',
    'twelve\ncharacters',
  ])('rejects policy-invalid passwords', (value) => {
    expect(validPassword(value)).toBe(false);
  });
  it('counts Unicode code points and verifies salted scrypt without truncation', async () => {
    expect(validPassword('😀'.repeat(128))).toBe(true);
    expect(validPassword('😀'.repeat(129))).toBe(false);
    const password = 'valid-password-' + randomBytes(8).toString('hex');
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(password + 'x', first)).toBe(false);
    expect(await verifyPassword(password)).toBe(false);
    expect(await verifyPassword(password, 'scrypt$1$8$1$bad')).toBe(false);
  }, 15000);
});

describe('auth transaction failure handling', () => {
  const config = new ConfigService<Configuration, true>();
  const access = new AccessTokenService(config);
  const credentials = {
    email: 'unit@example.invalid',
    password: 'valid-password-here',
  };
  it.each(['40P01', '40001'])(
    'bounds retries for PostgreSQL rollback code %s',
    async (code) => {
      const transaction = jest
        .fn()
        .mockRejectedValue(
          new QueryFailedError(
            'fixture',
            [],
            Object.assign(new Error('controlled'), { code }),
          ),
        );
      const service = new AuthService(
        { transaction } as unknown as DataSource,
        config,
        access,
      );
      await expect(service.login(credentials)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(transaction).toHaveBeenCalledTimes(3);
    },
  );
  it('retries a rolled-back deadlock, but never retries unrelated/unknown failures', async () => {
    const deadlock = new QueryFailedError(
      'fixture',
      [],
      Object.assign(new Error('controlled'), { code: '40P01' }),
    );
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(deadlock)
      .mockResolvedValueOnce({ committed: true });
    const service = new AuthService(
      { transaction } as unknown as DataSource,
      config,
      access,
    );
    await expect(service.login(credentials)).resolves.toEqual({
      committed: true,
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    transaction
      .mockReset()
      .mockRejectedValue(new Error('unknown commit outcome'));
    await expect(service.login(credentials)).rejects.toThrow(
      'unknown commit outcome',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe('auth HTTP validation and verified identity', () => {
  let app: INestApplication;
  let base: string;
  let tokens: AccessTokenService;
  const cfg = {
    accessSecret: randomBytes(32).toString('hex'),
    issuer: 'unit-issuer',
    audience: 'unit-audience',
    accessTtlSeconds: 37,
    refreshTtlSeconds: 300,
  };
  const id = randomUUID();
  const lines: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AuthModule, UsersModule],
      controllers: [IdentityProbe],
    })
      .overrideProvider(UsersService)
      .useValue({
        profile: (userId: string) => ({ id: userId }),
        updateProfile: (userId: string, dto: Record<string, unknown>) => ({
          id: userId,
          ...dto,
        }),
        roles: () => ({ items: [], total: 0, offset: 0, limit: 20 }),
        changeRole: (actorId: string) => ({ actorId }),
      })
      .useMocker((token) =>
        token === ConfigService
          ? new ConfigService({ jwt: cfg })
          : token === DataSource
            ? {}
            : undefined,
      )
      .compile();
    const logger = new SafeJsonLogger((line) => lines.push(line));
    app = module.createNestApplication({ logger, bodyParser: false });
    configureHttp(app, logger);
    configureOpenApi(app);
    await initializeHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    tokens = app.get(AccessTokenService);
  });
  afterAll(async () => {
    await app?.close();
  });

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(base + '/api/v1/' + path, init);
    return {
      status: response.status,
      body: (await response.json()) as {
        data: unknown;
        error: { code: string };
      },
    };
  }
  it.each([
    {
      email: 'valid@example.invalid',
      password: 'valid-password-here',
      role: 'ADMIN',
    },
    {
      email: 'valid@example.invalid',
      password: 'valid-password-here',
      isActive: false,
    },
    {
      email: 'valid@example.invalid',
      password: 'valid-password-here',
      passwordHash: 'private',
    },
    { email: 'not-email', password: 'valid-password-here' },
    { email: 'valid@example.invalid', password: 'short' },
    {
      email: 'valid@example.invalid',
      password: 'valid-password-here',
      fullName: '',
    },
  ])('rejects invalid/protected registration input', async (body) => {
    expect(
      (
        await request('auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(400);
  });
  it.each(['x', 'a'.repeat(43), ' '.repeat(43)])(
    'rejects malformed/noncanonical refresh token',
    async (refreshToken) => {
      expect(
        (
          await request('auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          })
        ).status,
      ).toBe(400);
    },
  );
  it('uses verified claims and configured access lifetime', async () => {
    const token = await tokens.sign({ id, role: 'STAFF' }, new Date());
    const claims = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(37);
    expect(
      await request('identity-probe', {
        headers: {
          Authorization: 'Bearer ' + token,
          'X-User-Id': randomUUID(),
          'X-Role': 'ADMIN',
        },
      }),
    ).toMatchObject({
      status: 200,
      body: { data: { sub: id, role: 'STAFF' } },
    });
    expect(lines.join('')).not.toContain(token);
  });
  it.each([
    'missing',
    'opaque',
    'expired',
    'wrong-type',
    'bad-signature',
    'wrong-issuer',
    'wrong-audience',
    'wrong-alg',
    'missing-exp',
    'bad-role',
    'bad-sub',
    'future-iat',
  ])('rejects %s access credential', async (kind) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: kind === 'bad-sub' ? 'bad' : id,
      role: kind === 'bad-role' ? 'ROOT' : 'CUSTOMER',
      tokenType: kind === 'wrong-type' ? 'refresh' : 'access',
      iat: kind === 'future-iat' ? now + 100 : now - 10,
      exp: kind === 'expired' ? now - 1 : now + 200,
      iss: kind === 'wrong-issuer' ? 'other' : cfg.issuer,
      aud: kind === 'wrong-audience' ? 'other' : cfg.audience,
    };
    if (kind === 'missing-exp') delete (payload as Partial<typeof payload>).exp;
    const token =
      kind === 'opaque'
        ? randomBytes(32).toString('base64url')
        : await new SignJWT(payload)
            .setProtectedHeader({
              alg: kind === 'wrong-alg' ? 'HS384' : 'HS256',
              typ: 'JWT',
            })
            .sign(
              new TextEncoder().encode(
                kind === 'bad-signature'
                  ? randomBytes(64).toString('hex')
                  : cfg.accessSecret,
              ),
            );
    expect(
      (
        await request('identity-probe', {
          headers:
            kind === 'missing' ? {} : { Authorization: 'Bearer ' + token },
        })
      ).status,
    ).toBe(401);
  });
  it('publishes implemented account routes and replay contract', async () => {
    const spec = (await (await fetch(base + '/api/docs-json')).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/register',
        '/api/v1/auth/login',
        '/api/v1/auth/refresh',
        '/api/v1/auth/logout',
        '/api/v1/users/me',
        '/api/v1/users/me/password',
        '/api/v1/admin/users/roles',
        '/api/v1/admin/users/{id}/role',
      ]),
    );
    expect(JSON.stringify(spec.paths['/api/v1/auth/refresh'])).toContain(
      'no grace period',
    );
  });

  it.each(['CUSTOMER', 'STAFF', 'ADMIN'])(
    'own profile derives identity only from signed %s token',
    async (role) => {
      const token = await tokens.sign({ id, role }, new Date());
      expect(
        await request('users/me', {
          headers: {
            Authorization: 'Bearer ' + token,
            'X-User-Id': randomUUID(),
          },
        }),
      ).toMatchObject({ status: 200, body: { data: { id } } });
      expect(
        (
          await request('admin/users/roles', {
            headers: { Authorization: 'Bearer ' + token },
          })
        ).status,
      ).toBe(role === 'ADMIN' ? 200 : 403);
    },
  );
  it.each(['users/me', 'admin/users/roles'])(
    'rejects guest on %s',
    async (path) => {
      expect((await request(path)).status).toBe(401);
    },
  );
  it.each([
    { role: 'ADMIN' },
    { userId: randomUUID() },
    { avatarUrl: 'https://example.invalid/avatar.png' },
    { passwordHash: 'protected' },
    { email: 'other@example.invalid' },
    { phoneNumber: 'invalid' },
    { fullName: '' },
  ])('rejects profile mass assignment/invalid input', async (body) => {
    const token = await tokens.sign({ id, role: 'CUSTOMER' }, new Date());
    expect(
      (
        await request('users/me', {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(400);
  });
  it.each([
    { currentPassword: 'short', newPassword: 'valid-password-here' },
    { currentPassword: 'valid-password-here', newPassword: 'short' },
    {
      currentPassword: 'valid-password-here',
      newPassword: 'valid-password-here',
    },
    {
      currentPassword: 'valid-password-here',
      newPassword: 'replacement-password-here',
      userId: randomUUID(),
    },
  ])('rejects invalid/same/protected password input', async (body) => {
    const token = await tokens.sign({ id, role: 'CUSTOMER' }, new Date());
    expect(
      (
        await request('users/me/password', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(400);
  });
});
