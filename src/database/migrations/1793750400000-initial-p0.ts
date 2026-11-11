import { MigrationInterface, QueryRunner } from 'typeorm';

/** Initial application schema; migrations are the database schema authority. */
export class InitialP01793750400000 implements MigrationInterface {
  name = 'InitialP01793750400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('typeorm_migrations', 'typeorm_metadata')",
      [],
      true,
    );
    if (existing.records.length)
      throw new Error(
        'Initial migration requires an empty public schema; existing tables were not changed',
      );
    await queryRunner.query(String.raw`CREATE TABLE users (
  id uuid PRIMARY KEY,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role varchar(16) NOT NULL DEFAULT 'CUSTOMER',
  is_active boolean NOT NULL DEFAULT true,
  full_name varchar(200),
  phone_number varchar(32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND length(email) > 3),
  CONSTRAINT users_password_hash_present CHECK (length(btrim(password_hash)) > 0),
  CONSTRAINT users_role_valid CHECK (role IN ('CUSTOMER','STAFF','ADMIN'))
);`);
    await queryRunner.query(String.raw`CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  family_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  consumed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason varchar(24),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT refresh_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT refresh_status_valid CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  CONSTRAINT refresh_expiry_valid CHECK (expires_at > created_at),
  CONSTRAINT refresh_consumption_valid CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT refresh_revocation_valid CHECK ((status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= created_at AND revocation_reason IS NOT NULL AND revocation_reason IN ('LOGOUT','PASSWORD_CHANGE','REPLAY')) OR (status <> 'REVOKED' AND revoked_at IS NULL AND revocation_reason IS NULL))
);`);
    await queryRunner.query(String.raw`CREATE TABLE role_change_audit (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  affected_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  old_role varchar(16) NOT NULL,
  new_role varchar(16) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_audit_values CHECK (old_role IN ('CUSTOMER','STAFF','ADMIN') AND new_role IN ('CUSTOMER','STAFF','ADMIN') AND old_role <> new_role)
);`);
    await queryRunner.query(String.raw`CREATE TABLE products (
  id uuid PRIMARY KEY,
  name varchar(250) NOT NULL,
  description text,
  price_vnd bigint NOT NULL,
  stock_available integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  image_path varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT product_price_positive CHECK (price_vnd > 0),
  CONSTRAINT product_stock_nonnegative CHECK (stock_available >= 0),
  CONSTRAINT product_image_relative CHECK (image_path IS NULL OR (length(btrim(image_path)) > 0 AND image_path !~ '(^/|[\\:]|(^|/)\.\.(/|$))'))
);`);
    await queryRunner.query(String.raw`CREATE TABLE inventory_adjustment_audit (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  previous_stock integer NOT NULL,
  quantity_delta integer NOT NULL,
  new_stock integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_audit_quantities CHECK (previous_stock >= 0 AND new_stock >= 0 AND quantity_delta <> 0 AND previous_stock::bigint + quantity_delta::bigint = new_stock::bigint),
  CONSTRAINT inventory_audit_reason CHECK (length(btrim(reason)) > 0)
);`);
    await queryRunner.query(String.raw`CREATE TABLE orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'PENDING_PAYMENT',
  total_vnd bigint NOT NULL,
  recipient_name varchar(200) NOT NULL,
  recipient_phone varchar(32) NOT NULL,
  address_line varchar(500) NOT NULL,
  ward varchar(150),
  district varchar(150),
  province_city varchar(150) NOT NULL,
  postal_code varchar(20),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reservation_expires_at timestamptz NOT NULL,
  CONSTRAINT order_status_valid CHECK (status IN ('PENDING_PAYMENT','PAID','PROCESSING','SHIPPED','COMPLETED','CANCELLED','EXPIRED')),
  CONSTRAINT order_total_positive CHECK (total_vnd > 0),
  CONSTRAINT order_shipping_present CHECK (length(btrim(recipient_name)) > 0 AND length(btrim(recipient_phone)) > 0 AND length(btrim(address_line)) > 0 AND length(btrim(province_city)) > 0),
  CONSTRAINT order_expiry_valid CHECK (reservation_expires_at > created_at)
);`);
    await queryRunner.query(String.raw`CREATE TABLE order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  product_name varchar(250) NOT NULL,
  unit_price_vnd bigint NOT NULL,
  quantity integer NOT NULL,
  line_total_vnd bigint GENERATED ALWAYS AS (unit_price_vnd * quantity::bigint) STORED,
  CONSTRAINT order_item_product_unique UNIQUE (order_id, product_id),
  CONSTRAINT item_name_present CHECK (length(btrim(product_name)) > 0),
  CONSTRAINT item_values_positive CHECK (unit_price_vnd > 0 AND quantity > 0)
);`);
    await queryRunner.query(String.raw`CREATE TABLE order_status_history (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  previous_status varchar(24),
  new_status varchar(24) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT history_transition_valid CHECK ((previous_status IS NULL AND new_status = 'PENDING_PAYMENT' AND actor_user_id IS NULL) OR (previous_status IS NOT NULL AND ((previous_status = 'PENDING_PAYMENT' AND new_status IN ('PAID','CANCELLED','EXPIRED')) OR (previous_status = 'PAID' AND new_status = 'PROCESSING') OR (previous_status = 'PROCESSING' AND new_status = 'SHIPPED') OR (previous_status = 'SHIPPED' AND new_status = 'COMPLETED')))),
  CONSTRAINT history_human_actor CHECK (new_status NOT IN ('CANCELLED','PROCESSING','SHIPPED','COMPLETED') OR actor_user_id IS NOT NULL)
);`);
    await queryRunner.query(String.raw`CREATE TABLE payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  provider varchar(16) NOT NULL DEFAULT 'VNPAY',
  provider_reference varchar(100) NOT NULL UNIQUE,
  provider_transaction_reference varchar(100),
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  amount_vnd bigint NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'VND',
  payment_url text NOT NULL,
  response_code varchar(32),
  transaction_status_code varchar(32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  terminal_at timestamptz,
  CONSTRAINT payment_status_valid CHECK (status IN ('PENDING','SUCCESS','FAILED','EXPIRED')),
  CONSTRAINT payment_provider_valid CHECK (provider = 'VNPAY'),
  CONSTRAINT payment_currency_valid CHECK (currency = 'VND'),
  CONSTRAINT payment_amount_positive CHECK (amount_vnd > 0),
  CONSTRAINT payment_reference_present CHECK (length(btrim(provider_reference)) > 0 AND length(btrim(payment_url)) > 0),
  CONSTRAINT payment_expiry_valid CHECK (expires_at > created_at),
  CONSTRAINT payment_terminal_valid CHECK ((status = 'PENDING' AND terminal_at IS NULL) OR (status <> 'PENDING' AND terminal_at IS NOT NULL AND terminal_at >= created_at))
);`);
    await queryRunner.query(String.raw`CREATE TABLE payment_notifications (
  id uuid PRIMARY KEY,
  payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  correlation_id uuid NOT NULL,
  provider_reference varchar(100),
  provider_transaction_reference varchar(100),
  signature_verified boolean NOT NULL,
  reported_amount_vnd bigint,
  reported_currency varchar(16),
  response_code varchar(32),
  transaction_status_code varchar(32),
  outcome varchar(24) NOT NULL,
  safe_detail text,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_outcome_valid CHECK (outcome IN ('SETTLED','FAILED','DUPLICATE','INVALID','MISMATCH','UNKNOWN_REFERENCE','LATE','CONFLICT')),
  CONSTRAINT notification_verified_effect CHECK (outcome NOT IN ('SETTLED','FAILED') OR (signature_verified AND payment_id IS NOT NULL AND reported_amount_vnd IS NOT NULL AND reported_amount_vnd > 0 AND reported_currency IS NOT NULL AND reported_currency = 'VND'))
);`);
    await queryRunner.query(
      String.raw`CREATE INDEX refresh_user_family_idx ON refresh_tokens(user_id, family_id);`,
    );
    await queryRunner.query(
      String.raw`CREATE UNIQUE INDEX refresh_one_live_token_idx ON refresh_tokens(family_id) WHERE status = 'ACTIVE' AND consumed_at IS NULL;`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX role_audit_target_time_idx ON role_change_audit(affected_user_id, created_at, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX role_audit_actor_idx ON role_change_audit(actor_user_id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX product_public_name_idx ON products(is_active, name, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX product_public_price_idx ON products(is_active, price_vnd, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX inventory_audit_product_time_idx ON inventory_adjustment_audit(product_id, created_at, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX inventory_audit_actor_idx ON inventory_adjustment_audit(actor_user_id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX order_customer_time_idx ON orders(user_id, created_at, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX order_queue_idx ON orders(status, created_at, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX order_due_idx ON orders(reservation_expires_at, id) WHERE status = 'PENDING_PAYMENT';`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX item_product_idx ON order_items(product_id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX history_order_time_idx ON order_status_history(order_id, created_at, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX history_actor_idx ON order_status_history(actor_user_id);`,
    );
    await queryRunner.query(
      String.raw`CREATE UNIQUE INDEX history_one_initial_idx ON order_status_history(order_id) WHERE previous_status IS NULL;`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX payment_order_time_idx ON payments(order_id, created_at, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE UNIQUE INDEX payment_one_pending_idx ON payments(order_id) WHERE status = 'PENDING';`,
    );
    await queryRunner.query(
      String.raw`CREATE UNIQUE INDEX payment_one_success_idx ON payments(order_id) WHERE status = 'SUCCESS';`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX payment_due_idx ON payments(expires_at, id) WHERE status = 'PENDING';`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX notification_payment_time_idx ON payment_notifications(payment_id, received_at, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX notification_outcome_time_idx ON payment_notifications(outcome, received_at, id);`,
    );
    await queryRunner.query(
      String.raw`CREATE INDEX notification_correlation_idx ON payment_notifications(correlation_id);`,
    );
    await queryRunner.query(
      `INSERT INTO typeorm_metadata (type, database, "schema", "table", name, value) VALUES ('GENERATED_COLUMN', current_database(), 'public', 'order_items', 'line_total_vnd', 'unit_price_vnd * quantity::bigint')`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM typeorm_metadata WHERE type='GENERATED_COLUMN' AND "schema"='public' AND "table"='order_items' AND name='line_total_vnd'`,
    );
    await queryRunner.query('DROP TABLE "payment_notifications"');
    await queryRunner.query('DROP TABLE "payments"');
    await queryRunner.query('DROP TABLE "order_status_history"');
    await queryRunner.query('DROP TABLE "order_items"');
    await queryRunner.query('DROP TABLE "orders"');
    await queryRunner.query('DROP TABLE "inventory_adjustment_audit"');
    await queryRunner.query('DROP TABLE "products"');
    await queryRunner.query('DROP TABLE "role_change_audit"');
    await queryRunner.query('DROP TABLE "refresh_tokens"');
    await queryRunner.query('DROP TABLE "users"');
  }
}
