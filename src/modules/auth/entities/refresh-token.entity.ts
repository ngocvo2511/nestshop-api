import {
  Column,
  Entity,
  Check,
  Unique,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UuidEntity } from '../../../common/entities/uuid-entity';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
@Check('refresh_hash_format', "token_hash ~ '^[0-9a-f]{64}$'")
@Check('refresh_status_valid', "status IN ('ACTIVE','REVOKED','EXPIRED')")
@Check('refresh_expiry_valid', 'expires_at > created_at')
@Check(
  'refresh_consumption_valid',
  'consumed_at IS NULL OR consumed_at >= created_at',
)
@Check(
  'refresh_revocation_valid',
  "(status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= created_at AND revocation_reason IS NOT NULL AND revocation_reason IN ('LOGOUT','PASSWORD_CHANGE','REPLAY')) OR (status <> 'REVOKED' AND revoked_at IS NULL AND revocation_reason IS NULL)",
)
@Unique('refresh_tokens_token_hash_key', ['tokenHash'])
@Index('refresh_user_family_idx', ['userId', 'familyId'])
@Index('refresh_one_live_token_idx', ['familyId'], {
  unique: true,
  where: "status = 'ACTIVE' AND consumed_at IS NULL",
})
export class RefreshToken extends UuidEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, select: false })
  tokenHash!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({
    name: 'revocation_reason',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  revocationReason!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'refresh_tokens_user_id_fkey',
  })
  userRelation?: User;
}
