import { Column, Entity, Check, Unique } from 'typeorm';
import { UuidEntity } from '../../../common/entities/uuid-entity';

@Entity('users')
@Check(
  'users_email_normalized',
  'email = lower(btrim(email)) AND length(email) > 3',
)
@Check('users_password_hash_present', 'length(btrim(password_hash)) > 0')
@Check('users_role_valid', "role IN ('CUSTOMER','STAFF','ADMIN')")
@Unique('users_email_key', ['email'])
export class User extends UuidEntity {
  @Column({ name: 'email', type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash!: string;

  @Column({ name: 'role', type: 'varchar', length: 16, default: 'CUSTOMER' })
  role!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'full_name', type: 'varchar', length: 200, nullable: true })
  fullName!: string | null;

  @Column({ name: 'phone_number', type: 'varchar', length: 32, nullable: true })
  phoneNumber!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
