import { randomUUID } from 'node:crypto';
import { PrimaryColumn } from 'typeorm';

export abstract class UuidEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();
}
