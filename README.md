# E-commerce Backend API

NestJS e-commerce backend with TypeORM and PostgreSQL.

## Implemented scope

- Health, validated configuration, safe HTTP handling and PostgreSQL migrations.
- Accounts, JWT authentication and rotating refresh sessions.
- Profiles and audited role assignment.

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

Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` through the local process environment, then run `npm run admin:setup` after build/migration. Passwords must contain 12–128 characters without surrounding whitespace or control characters. Setup never promotes an existing non-admin or overwrites an existing administrator. Clear the setup variables afterward.

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

## Remaining scope

Order reads, cancellation/stock release, fulfillment, VNPay payments/IPN and expiration are not yet complete. Keep `VNPAY_MODE=unconfigured` and merchant/callback values blank. Checkout currently reserves stock without an automatic release workflow; use disposable development data while exercising the incomplete order lifecycle.

## Contributions

Use one branch per feature, for example `feat/product-catalog`, and Conventional Commit messages such as `feat(auth): rotate refresh tokens atomically`. Use the [PR template](.github/pull_request_template.md). Dependent PRs are stacked; merge repository setup, foundation, accounts/auth, catalog, images, inventory, checkout, then Docker. Preserve ancestry with merge commits, or restack dependents after squash/rebase merges.
