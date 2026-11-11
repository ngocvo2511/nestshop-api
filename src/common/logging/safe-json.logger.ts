import { LoggerService } from '@nestjs/common';

type Sink = (line: string) => void;

/** Framework messages/optional arguments may contain arbitrary exceptions or secrets: discard them. */
export class SafeJsonLogger implements LoggerService {
  constructor(
    private readonly sink: Sink = (line) => {
      process.stdout.write(line + '\n');
    },
  ) {}

  private framework(level: string): void {
    this.sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event: 'framework',
      }),
    );
  }
  log(): void {
    this.framework('info');
  }
  error(): void {
    this.framework('error');
  }
  warn(): void {
    this.framework('warn');
  }
  debug(): void {
    this.framework('debug');
  }
  verbose(): void {
    this.framework('debug');
  }
  fatal(): void {
    this.framework('error');
  }

  httpCompleted(
    correlationId: string,
    method: string,
    status: number,
    durationMs: number,
  ): void {
    this.sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: status >= 500 ? 'error' : 'info',
        event: 'http.completed',
        correlationId,
        method: /^[A-Z]{1,12}$/.test(method) ? method : 'OTHER',
        status,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  }

  startupReady(vnpay: 'unconfigured' | 'sandbox-configured'): void {
    this.sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'startup.ready',
        vnpay,
      }),
    );
  }

  imageCleanupFailed(
    productId: string,
    correlationId: string,
    stage: 'orphan' | 'superseded' | 'partial',
  ): void {
    this.sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'image.cleanup_failed',
        productId,
        correlationId,
        stage,
      }),
    );
  }

  startupFailed(error: unknown): void {
    const match =
      error instanceof Error
        ? /^Invalid environment: ([A-Z][A-Z0-9_]{0,63})(?:\s|$)/.exec(
            error.message,
          )
        : null;
    this.sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'startup.failed',
        ...(match ? { configurationKey: match[1] } : {}),
      }),
    );
  }
}
