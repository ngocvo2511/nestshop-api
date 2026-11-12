import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Configuration } from '../../config/configuration';
import { OrdersService } from '../orders/orders.service';
import { SafeJsonLogger } from '../../common/logging/safe-json.logger';

/** Single-instance deployment. Candidate reads never authorize mutations. */
@Injectable()
export class ExpirationScanner
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;
  private cursor?: string;
  private readonly logger = new SafeJsonLogger();
  constructor(
    @Inject(DataSource) private readonly source: DataSource | null,
    private readonly config: ConfigService<Configuration, true>,
    private readonly orders: OrdersService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.source) return;
    await this.scan();
    if (!this.stopping) {
      this.timer = setInterval(
        () => {
          void this.scan();
        },
        this.config.get('expiry', { infer: true }).scanIntervalSeconds * 1000,
      );
      this.timer.unref();
    }
  }

  async beforeApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  scan(): Promise<void> {
    if (this.stopping || !this.source) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.batch()
      .catch((error: unknown) => {
        this.logger.expiryFailed('candidates', undefined, error);
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async batch() {
    // UUID keyset rotates across ticks: a faulty oldest order cannot starve later batches.
    const rows: Array<{ id: string }> = await this.source!.query(
      `SELECT id FROM orders WHERE status='PENDING_PAYMENT'
       AND reservation_expires_at <= clock_timestamp()
       AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`,
      [
        this.cursor ?? null,
        this.config.get('expiry', { infer: true }).batchSize,
      ],
    );
    if (!rows.length) {
      this.cursor = undefined;
      return;
    }
    for (const { id } of rows) {
      if (this.stopping) break;
      try {
        await this.orders.expire(id);
      } catch (error) {
        this.logger.expiryFailed('order', id, error);
      }
      this.cursor = id;
    }
    // Attempt finality is UNVERIFIED: due attempts deliberately remain PENDING.
    // Order termination expires them only as part of the reservation transaction.
  }
}
