import { Column, Entity, Check, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UuidEntity } from '../../../common/entities/uuid-entity';
import { User } from './user.entity';

@Entity('role_change_audit')
@Check(
  'role_audit_values',
  "old_role IN ('CUSTOMER','STAFF','ADMIN') AND new_role IN ('CUSTOMER','STAFF','ADMIN') AND old_role <> new_role",
)
@Index('role_audit_target_time_idx', ['affectedUserId', 'createdAt', 'id'])
@Index('role_audit_actor_idx', ['actorUserId'])
export class RoleChangeAudit extends UuidEntity {
  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  @Column({ name: 'affected_user_id', type: 'uuid' })
  affectedUserId!: string;

  @Column({ name: 'old_role', type: 'varchar', length: 16 })
  oldRole!: string;

  @Column({ name: 'new_role', type: 'varchar', length: 16 })
  newRole!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'actor_user_id',
    foreignKeyConstraintName: 'role_change_audit_actor_user_id_fkey',
  })
  actorUserRelation?: User;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    cascade: false,
  })
  @JoinColumn({
    name: 'affected_user_id',
    foreignKeyConstraintName: 'role_change_audit_affected_user_id_fkey',
  })
  affectedUserRelation?: User;
}
