# E-commerce Backend API

NestJS e-commerce backend with TypeORM and PostgreSQL.

## Implemented scope

- Health, validated configuration, safe HTTP handling and PostgreSQL migrations.
- Accounts, JWT authentication and rotating refresh sessions.
- Profiles and audited role assignment.
- Product catalog browsing and administration.
- Audited manual inventory adjustments.
- Atomic checkout with immutable snapshots and stock reservations.
- Validated JPEG/PNG/WebP upload and safe product-image reads.
- Customer-owned order list/detail/history and atomic cancellation with one-time stock release.
- Shared STAFF/ADMIN fulfillment queue, detail/history and audited forward-only status transitions.
- Owner-only VNPay Sandbox payment URL initiation with exact amounts and unresolved-attempt protection.

## Development

Use Node **24.22.2** and npm **11.12.1**, matching the runtime pins and package engines.

```powershell
npm ci
Copy-Item .env.example .env
```

Set `DB_PASSWORD`, a generated `JWT_ACCESS_SECRET` of at least 32 characters, and connection settings in the ignored `.env`. The blank examples intentionally fail validation until configured. Use a dedicated PostgreSQL database with an empty public schema for the initial migration.

```powershell
npm run build
npm run migration:run
npm run seed
npm run dev
```

Startup requires database connectivity and current migrations; schema synchronization and automatic migration are disabled. The development seed only inserts missing demo products and preserves existing records. It is disabled in production.

Health: `http://127.0.0.1:3000/api/v1/health`. Interactive API documentation: `http://127.0.0.1:3000/api/docs`; OpenAPI JSON: `/api/docs-json`. The default listener binds to loopback.

## API behavior

JSON responses use `{success:true,data,meta:{correlationId}}` or `{success:false,error:{status,code,message,details?},meta:{correlationId}}`. Unknown/protected fields are rejected, JSON bodies are capped at 64 KiB, and valid UUIDv4 correlation IDs are echoed in `X-Correlation-ID`. Logs omit request bodies, credentials and raw exception messages. Health is process liveness; database readiness is checked at startup.

Money uses integer VND decimal strings at API boundaries and BigInt arithmetic. Authenticated mutations use JWT roles; access JWT claims remain valid until expiry after logout, password change or role change. Refresh tokens are opaque, stored hashed and rotated atomically with replay revocation.

## Initial administrator

Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` through the local process environment, then run `npm run admin:setup` after build/migration. Passwords must contain 12â€“128 characters without surrounding whitespace or control characters. Setup never promotes an existing non-admin or overwrites an existing administrator. Clear the setup variables afterward.

## Checks

```powershell
npm run lint
npm run format:check
npm test
npm run build
npm run test:smoke
npm run test:integration
```

Integration tests require Docker with Linux containers and use an isolated PostgreSQL 18.6 Compose project with generated credentials. Their runner removes only its disposable resources. Smoke checks use the compiled application with database access disabled in test mode; they are separate from database acceptance.

## Docker Compose

Docker with Linux containers and Compose v2.40+ is required. Copy the example and fill independent generated database/JWT secrets in the ignored `.env.compose`.

```powershell
Copy-Item .env.compose.example .env.compose
docker compose --env-file .env.compose build api
docker compose --env-file .env.compose up -d --wait
docker compose --env-file .env.compose exec -T api npm run seed
```

The API is published on `http://127.0.0.1:3300`; PostgreSQL is private to the Compose network. A healthy database and successful one-shot migration gate API startup. The application runs as the `node` user, with persistent database and upload volumes. Use a fresh `-p <project-name>` if the default project already exists.

`docker compose --env-file .env.compose down` retains data. Do not add `--volumes` to routine shutdown. Changing the environment password does not rotate credentials in an existing database volume.

`npm run verify:compose` verifies image build, readiness, repeated migration/seed/admin commands and database/upload persistence using its own disposable project.

## VNPay Sandbox configuration

Keep `VNPAY_MODE=unconfigured` unless using assigned Sandbox settings. Configure `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` and `VNPAY_IPN_URL` in the ignored `.env` or `.env.compose`; keep credentials and signed payment URLs out of logs and version control. Supported settings are API 2.1.0, locale `vn` or `en`, and timezone `Asia/Ho_Chi_Minh`. The IPN URL must be registered with the merchant; generating a signed URL makes no outbound provider request.

`POST /api/v1/orders/:id/payment-attempts` accepts an empty body for an eligible CUSTOMER-owned order. Prices and amounts come from persisted data. An unresolved PENDING attempt conflicts even after its local target time; safe URL reuse and provider finality are not assumed.

Callback settlement, browser return and reconciliation are introduced by the dependent callback feature.

## Remaining scope

Callback settlement/reconciliation, expiration/recovery workers and real Sandbox acceptance remain open. Cancellation releases an eligible reservation once; automatic expiry release is not implemented. Use disposable development data for the incomplete lifecycle.

## Contributions

Use one branch per feature, for example `feat/product-catalog`, and Conventional Commit messages such as `feat(auth): rotate refresh tokens atomically`. Use the [PR template](.github/pull_request_template.md). All PRs target `main`. If a feature depends on another open PR, merge that prerequisite first using Create a merge commit; GitHub then removes its changes from the dependent diff. After squash/rebase merges, restack dependent branches before continuing.
