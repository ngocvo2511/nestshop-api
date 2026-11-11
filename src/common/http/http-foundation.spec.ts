import 'reflect-metadata';
import {
  Body,
  CanActivate,
  Controller,
  Get,
  HttpCode,
  HttpException,
  INestApplication,
  LoggerService,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { randomUUID } from 'node:crypto';
import { HealthModule } from '../../modules/health/health.module';
import { ShippingDto } from '../../modules/orders/dto/shipping.dto';
import { configureOpenApi } from '../../openapi';
import { SafeJsonLogger } from '../logging/safe-json.logger';
import { IsVndAmount, MAX_DB_INTEGER } from '../validation/contract-validators';
import { ApiError } from './api-error';
import { configureHttp, initializeHttp } from './configure-http';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { UuidParamDto } from './dto/uuid-param.dto';
import { ResponseMode } from './response-mode';
import { EmptyBodyPipe } from './empty-body.pipe';

class ProbeBody {
  @IsVndAmount()
  priceVnd!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_DB_INTEGER)
  quantity!: number;

  @IsBoolean()
  isActive!: boolean;

  @Type(() => ShippingDto)
  @IsDefined()
  @ValidateNested()
  shipping!: ShippingDto;
}

class RejectingGuard implements CanActivate {
  canActivate(): boolean {
    throw new HttpException('private guard diagnostic', 401);
  }
}

// These routes only exist inside this test module, never in the application.
@Controller('probe')
class ProbeController {
  @Get('page') page(@Query() query: PaginationQueryDto) {
    return query;
  }
  @Post('body') body(@Body() body: ProbeBody) {
    return body;
  }
  @Get('id/:id') id(@Param() params: UuidParamDto) {
    return params;
  }
  @Get('error') error() {
    throw new Error('postgres password=private-db; token=private-token');
  }
  @Get('http-error') httpError() {
    throw new HttpException('private SQL and signed URL', 400);
  }
  @Get('domain-error') domainError() {
    throw new ApiError('ORDER_NOT_ELIGIBLE');
  }
  @Post('empty') @HttpCode(204) empty(@Body(EmptyBodyPipe) body: unknown) {
    void body;
    return { mustNotAppear: true };
  }
  @Get('file') @ResponseMode('file') file() {
    return new StreamableFile(Buffer.from('binary-fixture'), {
      type: 'image/png',
    });
  }
  @Get('automatic-file') automaticFile() {
    return new StreamableFile(Buffer.from('automatic-file'));
  }
  @Get('missing-file') @ResponseMode('file') missingFile() {
    throw new HttpException('host/path/private', 404);
  }
  @Get('provider') @ResponseMode('provider') provider() {
    return { RspCode: '02', Message: 'Already confirmed' };
  }
  @Get('provider-error') @ResponseMode('provider') providerError() {
    throw new Error('private callback');
  }
  @Get('provider-guard')
  @ResponseMode('provider')
  @UseGuards(RejectingGuard)
  providerGuard() {
    return { RspCode: '00', Message: 'Should not run' };
  }
  @Post('provider-body') @ResponseMode('provider') providerBody(
    @Body() body: ProbeBody,
  ) {
    void body;
    return { RspCode: '00', Message: 'Handled fixture' };
  }
}

interface JsonEnvelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: {
    status: number;
    code: string;
    message: string;
    details?: { field: string; rules: string[] }[];
  };
  meta: { correlationId: string };
}

describe('HTTP foundation (real HTTP, isolated test controllers)', () => {
  let app: INestApplication;
  let base: string;
  const lines: string[] = [];

  beforeAll(async () => {
    const logger = new SafeJsonLogger((line) => {
      lines.push(line);
    });
    const module = await Test.createTestingModule({
      imports: [HealthModule],
      controllers: [ProbeController],
    }).compile();
    app = module.createNestApplication({ logger, bodyParser: false });
    configureHttp(app, logger);
    configureOpenApi(app);
    await initializeHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });

  async function getJson(
    path: string,
    init?: RequestInit,
  ): Promise<{ response: Response; body: JsonEnvelope }> {
    const response = await fetch(base + path, init);
    return { response, body: (await response.json()) as JsonEnvelope };
  }

  const shipping = {
    recipientName: ' Recipient ',
    recipientPhone: '+84901234567',
    addressLine: ' Address ',
    provinceCity: 'City',
    ward: null,
  };
  const validBody = () => ({
    priceVnd: '9223372036854775807',
    quantity: 1,
    isActive: true,
    shipping: { ...shipping },
  });

  it('serves public lightweight versioned health and correlates headers/envelope', async () => {
    const id = randomUUID();
    const { response, body } = await getJson('/api/v1/health', {
      headers: { 'X-Correlation-ID': id },
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { status: 'ok' },
      meta: { correlationId: id },
    });
    expect(response.headers.get('x-correlation-id')).toBe(id);
    expect(response.headers.get('x-powered-by')).toBeNull();
    const outside = await fetch(base + '/');
    expect(outside.status).toBe(404);
    expect(await outside.text()).toContain('"success":false');
    expect(
      (await getJson('/api/v1/health?password=private-query')).response.status,
    ).toBe(400);
  });

  it.each(['bad header', 'x'.repeat(65), `${randomUUID()},${randomUUID()}`])(
    'replaces an invalid/repeated/oversized correlation header',
    async (value) => {
      const { body, response } = await getJson('/api/v1/health', {
        headers: { 'X-Correlation-ID': value },
      });
      expect(body.meta.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.meta.correlationId).not.toBe(value);
      expect(response.headers.get('x-correlation-id')).toBe(
        body.meta.correlationId,
      );
    },
  );

  it('converts only bounded canonical query integers and applies pagination defaults', async () => {
    expect((await getJson('/api/v1/probe/page')).body.data).toEqual({
      offset: 0,
      limit: 20,
    });
    expect(
      (await getJson('/api/v1/probe/page?offset=100&limit=5')).body.data,
    ).toEqual({ offset: 100, limit: 5 });
  });

  it.each([
    'limit=1e2',
    'limit=1.5',
    'limit=NaN',
    'limit=Infinity',
    'limit=',
    'limit=00',
    'limit=101',
    'offset=-1',
    'offset=1000001',
    'offset=9007199254740993',
    'limit=1&limit=2',
    'offset[x]=1',
    'role=ADMIN',
  ])('rejects malformed/unknown query: %s', async (query) => {
    const { response, body } = await getJson(`/api/v1/probe/page?${query}`);
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('accepts exact bigint strings, strict body integers, nested DTOs and trims only declared text', async () => {
    const { response, body } = await getJson('/api/v1/probe/body', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    });
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      priceVnd: '9223372036854775807',
      quantity: 1,
      shipping: {
        recipientName: 'Recipient',
        addressLine: 'Address',
        ward: null,
      },
    });
  });

  it.each([
    { priceVnd: 100 },
    { priceVnd: '1.5' },
    { priceVnd: '01' },
    { priceVnd: '0' },
    { priceVnd: '9223372036854775808' },
    { quantity: '1' },
    { quantity: 1.5 },
    { quantity: 0 },
    { quantity: 2147483648 },
    { quantity: null },
    { isActive: 'false' },
    { role: 'ADMIN' },
    { stockAvailable: 99 },
    { totalVnd: '1' },
    { shipping: undefined },
    { shipping: null },
    { shipping: { ...shipping, role: 'ADMIN' } },
    { shipping: { ...shipping, recipientPhone: 'not-a-phone' } },
    { shipping: { ...shipping, ward: ' ' } },
    { shipping: { ...shipping, recipientName: 'unsafe\nname' } },
    { shipping: { ...shipping, addressLine: 'x'.repeat(501) } },
  ])(
    'rejects invalid/protected body fields without coercion or value disclosure',
    async (patch) => {
      const { response, body } = await getJson('/api/v1/probe/body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody(), ...patch }),
      });
      expect(response.status).toBe(400);
      expect(body.error?.code).toBe('VALIDATION_FAILED');
      expect(body.error?.details?.length).toBeGreaterThan(0);
      expect(JSON.stringify(body)).not.toContain('unsafe');
      expect(JSON.stringify(body)).not.toContain('not-a-phone');
      expect(JSON.stringify(body)).not.toContain('target');
    },
  );

  it('rejects malformed JSON, oversized bodies, non-JSON types and invalid UUID params safely', async () => {
    for (const [body, status, code] of [
      ['{"secret":"private-malformed",', 400, 'MALFORMED_JSON'],
      [
        JSON.stringify({ padding: 'x'.repeat(65536) }),
        413,
        'PAYLOAD_TOO_LARGE',
      ],
    ] as const) {
      const result = await getJson('/api/v1/probe/body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(result.response.status).toBe(status);
      expect(result.body.error?.code).toBe(code);
      expect(JSON.stringify(result.body)).not.toContain('private-malformed');
    }
    expect(
      (
        await getJson('/api/v1/probe/body', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: 'private-text',
        })
      ).response.status,
    ).toBe(415);
    expect((await getJson('/api/v1/probe/id/not-a-uuid')).response.status).toBe(
      400,
    );
    const id = randomUUID();
    expect(
      (await getJson(`/api/v1/probe/id/${id.toUpperCase()}`)).body.data,
    ).toEqual({ id });
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects raw %s before class-transformer can drop it',
    async (key) => {
      const raw =
        JSON.stringify(validBody()).slice(0, -1) +
        `,"${key}":{"polluted":true}}`;
      const { response, body } = await getJson('/api/v1/probe/body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      });
      expect(response.status).toBe(400);
      expect(body.error?.details).toEqual([
        { field: 'input', rules: ['forbiddenProperty'] },
      ]);
      expect(Object.prototype).not.toHaveProperty('polluted');
    },
  );

  it('bounds JSON nesting before transformation', async () => {
    let nested: unknown = { value: 'private-deep-value' };
    for (let i = 0; i < 20; i++) nested = { child: nested };
    const { response, body } = await getJson('/api/v1/probe/body', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody(), nested }),
    });
    expect(response.status).toBe(400);
    expect(body.error?.details).toEqual([
      { field: 'input', rules: ['maxDepth'] },
    ]);
    expect(JSON.stringify(body)).not.toContain('private-deep-value');
  });

  it('uses safe catalog messages for framework/domain/unexpected errors', async () => {
    for (const [path, status, code] of [
      ['error', 500, 'INTERNAL_ERROR'],
      ['http-error', 400, 'BAD_REQUEST'],
      ['domain-error', 409, 'ORDER_NOT_ELIGIBLE'],
      ['unknown', 404, 'NOT_FOUND'],
    ] as const) {
      const { body, response } = await getJson(
        `/api/v1/probe/${path}?token=private-query`,
      );
      expect(response.status).toBe(status);
      expect(body.error).toMatchObject({ status, code });
      expect(JSON.stringify(body)).not.toContain('private');
      expect(response.headers.get('x-correlation-id')).toBe(
        body.meta.correlationId,
      );
    }
  });

  it('preserves bodyless 204, file content/types and safe missing-file errors', async () => {
    const empty = await fetch(base + '/api/v1/probe/empty', { method: 'POST' });
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe('');
    const forbidden = await getJson('/api/v1/probe/empty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"role":"ADMIN"}',
    });
    expect(forbidden.response.status).toBe(400);
    for (const [path, content] of [
      ['file', 'binary-fixture'],
      ['automatic-file', 'automatic-file'],
    ]) {
      const file = await fetch(base + '/api/v1/probe/' + path);
      expect(await file.text()).toBe(content);
      if (path === 'file')
        expect(file.headers.get('content-type')).toBe('image/png');
    }
    const missing = await getJson('/api/v1/probe/missing-file');
    expect(missing.body.error?.code).toBe('NOT_FOUND');
  });

  it('keeps provider JSON plain and returns retry acknowledgement on handler/guard/validation/parser errors', async () => {
    expect(await (await fetch(base + '/api/v1/probe/provider')).json()).toEqual(
      { RspCode: '02', Message: 'Already confirmed' },
    );
    for (const path of ['provider-error', 'provider-guard']) {
      const response = await fetch(base + '/api/v1/probe/' + path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        RspCode: '99',
        Message: 'Processing error',
      });
    }
    for (const body of ['{}', '{invalid']) {
      const response = await fetch(base + '/api/v1/probe/provider-body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        RspCode: '99',
        Message: 'Processing error',
      });
    }
  });

  it('exposes an OpenAPI foundation matching actual health and Bearer security', async () => {
    const response = await fetch(base + '/api/docs-json');
    const spec = (await response.json()) as {
      paths: Record<string, unknown>;
      components: {
        securitySchemes: Record<string, unknown>;
        schemas: Record<string, unknown>;
      };
    };
    expect(response.status).toBe(200);
    expect(spec.paths['/api/v1/health']).toBeDefined();
    expect(spec.paths['/api/v1/auth/login']).toBeUndefined();
    expect(spec.components.securitySchemes.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(spec.components.schemas.ShippingDto).toBeDefined();
    expect(spec.components.schemas.ErrorEnvelope).toBeDefined();
    expect((await fetch(base + '/api/docs')).status).toBe(200);
  });

  it('logs only operational allowlisted fields, never headers/body/path/query/errors', async () => {
    const service: LoggerService = new SafeJsonLogger((line) => {
      lines.push(line);
    });
    service.error(new Error('private-framework'), 'private-stack');
    const id = randomUUID();
    await getJson(
      '/api/v1/health?paymentUrl=private-url&token=private-callback',
      {
        headers: {
          authorization: 'Bearer private-authorization',
          cookie: 'refreshToken=private-cookie',
          'X-Correlation-ID': id,
        },
      },
    );
    const records = lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(
      records.some(
        (record) =>
          record.event === 'http.completed' &&
          record.correlationId === id &&
          record.status === 400,
      ),
    ).toBe(true);
    expect(lines.join('\n')).not.toContain('private');
    for (const record of records)
      expect(
        Object.keys(record).every((key) =>
          [
            'timestamp',
            'level',
            'event',
            'correlationId',
            'method',
            'status',
            'durationMs',
          ].includes(key),
        ),
      ).toBe(true);
  });
});
