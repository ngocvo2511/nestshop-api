# E-commerce Backend API

NestJS e-commerce backend with TypeORM and PostgreSQL.

## Table of contents

- [Implemented scope](#implemented-scope)
- [Development](#development)
- [API behavior](#api-behavior)
- [Account and catalog management](#account-and-catalog-management)
- [Initial administrator](#initial-administrator)
- [Checks](#checks)
- [Docker Compose](#docker-compose)
- [VNPay Sandbox configuration](#vnpay-sandbox-configuration)
- [Expiration and recovery](#expiration-and-recovery)
- [Remaining scope](#remaining-scope)
- [Contributions](#contributions)
- [Quality checks](#quality-checks)
- [Isolated source verification](#isolated-source-verification)

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
- Signature-verified IPN settlement, a nonauthoritative browser return and read-only ADMIN payment reconciliation.
- Single-instance startup/periodic order expiry with bounded non-overlapping scans and atomic stock release.

## Development

Use Node **24.22.2** and npm **11.12.1**, matching the runtime pins and package engines.

```powershell
npm ci
Copy-Item .env.example .env
```

Set `DB_PASSWORD`, a generated `JWT_ACCESS_SECRET` of at least 32 characters, and connection settings in the ignored `.env`. The blank examples intentionally fail validation until configured. Use a dedicated PostgreSQL database with an empty public schema for the initial migration.

Start PostgreSQL and create the `DB_USERNAME` role and `DB_DATABASE` database first; migrations create tables, not the database or role. Generate each secret separately with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. VNPay is optional; leave its four merchant/callback values empty until following the Sandbox section below.

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

## Account and catalog management

Login returns tokens plus a basic user (`id`, `email`, `role`, `fullName`). Refresh returns only the new tokens and their lifetimes; it no longer returns `user`. Fetch `GET /api/v1/users/me` for a full profile. Clients using the old login/refresh profile fields must update their response handling.

ADMIN endpoints:

- `POST /api/v1/admin/staff`: create a STAFF account with email, password and optional fullName/phoneNumber. Role is fixed; no session is created.
- `GET /api/v1/admin/users/roles?role=STAFF`: list staff, including inactive staff.
- `PATCH /api/v1/admin/staff/:id/status` with `{"isActive":false}` or `true`: disable or enable STAFF only; accounts and historical references are retained.
- `GET /api/v1/admin/products?status=inactive`: management catalog; status supports `all`, `active`, `inactive`, default `all`. Supports the public catalog's search, price, sort and pagination parameters.
- `GET /api/v1/admin/products/:id`: product details including inactive products.
- `GET /api/v1/products/:id/stock-adjustments?offset=0&limit=20`: manual adjustment audit, newest first (createdAt/id), including inactive products. This is not a ledger of order reservation/cancellation/expiry movements.

Disabling a STAFF account revokes refresh sessions (ordinary LOGOUT reason) in the same transaction and blocks subsequent bearer-authenticated requests, including previously issued access tokens. Already-running requests may finish. Enabling does not restore refresh tokens; unexpired access tokens can be used again. Active-account status is checked against PostgreSQL on each authenticated request; role claims still remain valid until expiry after a role change.

Products are removed from sale with `PATCH /api/v1/products/:id` and `{"isActive":false}`, and restored with `true`. Public catalog/detail/image routes remain active-only. There is no physical product/account deletion API. Product image upload remains a separate `POST /api/v1/products/:id/image` multipart request; clients can retry an image upload after saving product JSON.

Swagger account, product, image and inventory operations document applicable error codes and example responses per operation.

## Initial administrator

Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` through the local process environment, then run `npm run admin:setup` after build/migration. Passwords must contain 12-128 characters without surrounding whitespace or control characters. Setup never promotes an existing non-admin or overwrites an existing administrator. Clear the setup variables afterward.

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

Copy the example only on first setup. Set `COMPOSE_DB_PASSWORD` and `COMPOSE_JWT_ACCESS_SECRET` (at least 32 characters), generating each as described above. Compose creates the database and role automatically. Host commands use `.env`; Docker commands below use `.env.compose`, so editing `.env` does not update container settings.

Compose also starts ngrok after the API is healthy. Set `NGROK_AUTHTOKEN` and
`NGROK_DOMAIN` (your assigned domain without `https://`) in `.env.compose`.
Set `VNPAY_IPN_URL=https://<NGROK_DOMAIN>/api/v1/payments/vnpay/ipn` and register
that full URL with VNPay when enabling `VNPAY_MODE=sandbox` as described below.
Leave all four VNPay values empty when using `unconfigured`.
ngrok forwards directly to `api:3000` on the Compose
network; no separate host ngrok process is needed. Stop an existing host tunnel
using the same domain before starting this stack. Check the tunnel with
`docker compose --env-file .env.compose logs --tail 30 ngrok`.
To run only the API and database without ngrok, use
`docker compose --env-file .env.compose up -d --wait api`.

```powershell
Copy-Item .env.compose.example .env.compose
# Fill .env.compose before running the following commands.
docker compose --env-file .env.compose build api
docker compose --env-file .env.compose up -d --wait
docker compose --env-file .env.compose exec -T api npm run seed
```

The API is published on `http://127.0.0.1:3300`; PostgreSQL is private to the Compose network. A healthy database and successful one-shot migration gate API startup. The application runs as the `node` user, with persistent database and upload volumes. Use a fresh `-p <project-name>` if the default project already exists.

Health: `http://127.0.0.1:3300/api/v1/health`; Swagger: `http://127.0.0.1:3300/api/docs`. If you change `COMPOSE_API_PORT`, use that port instead. For initial admin setup, set `$env:INITIAL_ADMIN_EMAIL` and `$env:INITIAL_ADMIN_PASSWORD` in PowerShell, then run `docker compose --env-file .env.compose exec -T -e INITIAL_ADMIN_EMAIL -e INITIAL_ADMIN_PASSWORD api npm run admin:setup`; remove both local variables afterward with `Remove-Item Env:INITIAL_ADMIN_EMAIL, Env:INITIAL_ADMIN_PASSWORD`.

After changing `.env.compose`, run `docker compose --env-file .env.compose up -d` to recreate affected services; `restart` does not reload environment values. After source changes, build the API again before starting it.

`docker compose --env-file .env.compose down` retains data. Do not add `--volumes` to routine shutdown. Changing the environment password does not rotate credentials in an existing database volume.

`npm run verify:compose` verifies image build, readiness, repeated migration/seed/admin commands and database/upload persistence using its own disposable project.

## VNPay Sandbox configuration

Without VNPay, keep `VNPAY_MODE=unconfigured` and leave `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL` and `VNPAY_IPN_URL` empty. Supplying any of those four values while still using `unconfigured` fails startup validation.

To enable Sandbox, edit `.env` for `npm run dev`, or `.env.compose` for Docker:

1. Set `VNPAY_MODE=sandbox` and fill **all four** values below.
2. Use the assigned Sandbox `VNPAY_TMN_CODE` (8 alphanumeric characters) and `VNPAY_HASH_SECRET`.
3. Set `VNPAY_RETURN_URL` to the browser destination. The backend callback is `http://localhost:3000/api/v1/payments/vnpay/return` for host development, or `http://localhost:3300/api/v1/payments/vnpay/return` for default Compose. Use `https://<NGROK_DOMAIN>/api/v1/payments/vnpay/return` when testing from another device. A frontend URL is also valid if that frontend implements the return page.
4. Set `VNPAY_IPN_URL=https://<NGROK_DOMAIN>/api/v1/payments/vnpay/ipn` and register that exact URL with the Sandbox merchant. This must point to your API, not VNPay's payment page. Keep the API and tunnel running during payment and callback delivery.
5. Restart the host app, or run `docker compose --env-file .env.compose up -d` for Docker. Generate a new payment attempt to use the updated Return URL.

Both callback URLs require HTTPS, except Return URL also accepts HTTP on localhost/loopback. Do not include query strings or fragments; Return URL is limited to 255 characters. Supported settings are API 2.1.0, locale `vn` or `en`, and timezone `Asia/Ho_Chi_Minh`. Keep credentials and signed payment URLs out of logs and version control. Generating a signed URL makes no outbound provider request.

`POST /api/v1/orders/:id/payment-attempts` accepts an empty body for an eligible CUSTOMER-owned order. Prices and amounts come from persisted data. An unresolved PENDING attempt conflicts even after its local target time; safe URL reuse and provider finality are not assumed.

`GET /api/v1/payments/vnpay/ipn` verifies the original signed query and commits applicable payment/order/history/receipt changes before returning its plain provider acknowledgement. It never deducts stock a second time. Browser `/return` reports a minimal nonauthoritative signed outcome; settlement happens only through IPN. ADMIN reconciliation endpoints expose safe canonical payment metadata and receipts without signed URLs or credentials.

## Expiration and recovery

Deploy one API instance. An in-process scanner runs one bounded batch before HTTP readiness, then every `EXPIRY_SCAN_INTERVAL_SECONDS` (default 60, range 1-86400). `EXPIRY_SCAN_BATCH_SIZE` defaults to 100 (range 1-1000). Each tick rotates a UUID cursor; after reaching the end it wraps on the next tick. Startup backlogs larger than one batch drain over subsequent ticks. Candidate failure is isolated and logged as `expiry.failed` with stage/order ID/allowlisted diagnostic; retries occur on the next cursor cycle. Scans in the same process share one promise. Shutdown stops scheduling and waits for the active operation before closing PostgreSQL. No distributed scheduler/infrastructure is included.

Order expiry and cancellation use one reservation termination operation, with order then attempts by ID then products by ID locks, current eligibility recheck, conditional transition, pending-attempt expiry, SYSTEM history for expiry, and stock restoration in one transaction. Overflow aborts everything for investigation. Settled orders keep their consumed stock. Attempt-only expiry is disabled because provider finality is unverified: passing the 20-minute target keeps PENDING and blocks replacement without releasing stock.

## Remaining scope

Genuine Sandbox callback delivery/ACK/retry, safe URL reuse and provider finality remain unverified. Automated quality checks do not establish genuine merchant acceptance or production readiness.

## Contributions

Use one branch per feature, for example `feat/product-catalog`, and Conventional Commit messages such as `feat(auth): rotate refresh tokens atomically`. Use the [PR template](.github/pull_request_template.md). All PRs target `main`. If a feature depends on another open PR, merge that prerequisite first using Create a merge commit; GitHub then removes its changes from the dependent diff. After squash/rebase merges, restack dependent branches before continuing.

## Quality checks

Use the pinned Node 24.22.2 and npm 11.12.1 with `npm ci`.

- `npm run test:cov` builds and runs unit/API plus real PostgreSQL tests against source TypeScript inside Jest. Global statements, branches, functions and lines must each reach 70%; every non-test source file remains in scope. These are combined metrics, not unit-only coverage. Reports are written to ignored `coverage/`.
- `npm run test:integration` independently tests the compiled application in child processes, including startup/recovery. Local runs create fresh random PostgreSQL Compose projects and remove only their own resources.
- `npm run benchmark` uses a fresh database with 1000 active products, 5 warmups and 50 sequential catalog requests. Server request-to-response-finish timing is matched by correlation ID; nearest-rank p95 must be below 500 ms. This is a bounded catalog check, not a load or production-performance guarantee. Measurements are retained in `tmp/reports/benchmark.json`.
- `npm run verify:compose` validates the compiled API contract and database/upload persistence. Each verification uses its own image tag and Compose project. Contract audit output is in `tmp/reports/openapi-audit.json`.

GitHub Actions runs separate PostgreSQL service jobs for coverage, compiled integration/smoke and benchmark, using pinned actions, read-only repository permissions and synthetic test credentials. Production dependency audit is enforced. Service mode is explicitly restricted to GitHub Actions and a loopback disposable service; local runs use the random Compose runner.

## Isolated source verification

`npm run verify:delivery` copies only the public source allowlist in `delivery-files.json` into a fresh system-temp directory. It installs dependencies from the lockfile and runs lint, formatting, coverage, compiled PostgreSQL integration, smoke, benchmark and Compose checks. Local documents, secrets, existing dependencies, build outputs, Git metadata and runtime data are excluded.

The source copy is retained for inspection. Results and input hashes are written to ignored `tmp/reports/`; this verifies the allowlisted source copy, not a Git clean clone. Changes to application inputs require a new verification run. Sandbox acceptance remains separate.
