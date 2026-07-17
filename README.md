# Constellation — private Dart/Flutter registry

Constellation is a production-oriented monorepo scaffold for a private Dart and Flutter package registry. It exposes a Hosted Pub Repository API V2 surface for `dart pub` and a separate control-plane API for the web app, administration, imports, code exploration, analysis, and scoring.

The repository runs immediately in demo mode with deterministic data. PostgreSQL, Valkey, MinIO, OIDC, durable queues, and real Dart/Flutter analyzers are represented by explicit adapters and schema boundaries; production integrations are deliberately not presented as complete where credentials or isolated infrastructure are required.

## What is implemented

- Modern Next.js UI with package search, filters, package details, minimum Dart/Flutter requirements, dependency constraints, versions, score breakdown, publishers, import wizard, token management, and administration.
- Historical file explorer with file tree, Markdown preview, structured pubspec preview, source viewer, raw view, simple version diff, and graceful binary fallback.
- Fastify API with separate `/api/packages/...` and `/v1/...` surfaces.
- Hosted Pub V2 package/version metadata, archive URL resolution, upload negotiation, upload adapter endpoint, and finalization endpoint.
- Control-plane routes for search, packages, files, scores, imports, analyses, PATs, retract/restore, and discontinue/undiscontinue.
- Database-backed accounts, HttpOnly login sessions, account-owned PATs, one-time PAT plaintext response, secret hashing with a server-side pepper, rate limits, CSP, and security headers.
- Administrator-managed user creation, forced first-login password changes, and a self-service account page for changing passwords at any time.
- Flutter SDK release explorer backed by Flutter's official Windows, macOS, and Linux release archives, with version, channel, Dart SDK, and commit search.
- Archive index validator for traversal, duplicate paths, oversized files, and unsafe symlink targets.
- Configurable worker pipeline with `pana`, `dart analyze`, `flutter analyze`, and `dartdoc` command steps plus a zero-SDK mock mode.
- Prisma schema covering packages, versions, files, dependencies, analysis, scores, publishers, permissions, tokens, imports, search documents, and audit logs.
- Unit/contract tests and safe/malformed fixture packages.

## Repository map

```text
apps/
  api/       Fastify registry and control-plane API
  web/       Next.js application
  worker/    Analysis and indexing worker pipeline
packages/
  contracts/ Shared Zod schemas and TypeScript types
  database/  Prisma schema, migration extension, and seed
  ui/        Shared UI primitives
  config/    Shared TypeScript configuration
fixtures/    Valid and malformed package fixtures
scripts/     Fixture generation utilities
```

## Run locally

Requirements: Node.js 22+, pnpm 10+, and optionally Docker Desktop.

```bash
cp .env.example .env
pnpm install
pnpm fixtures:create
pnpm dev
```

Open:

- Web app: `http://localhost:3000`
- API: `http://localhost:4000`
- OpenAPI UI: `http://localhost:4000/docs`
- Health check: `http://localhost:4000/health`

Demo mode is enabled by default. The API accepts no token or `Bearer demo-admin-token` and grants all demo scopes. Never enable demo mode in a production environment.

To run the infrastructure and applications in containers:

```bash
cp .env.example .env
docker compose up
```

PostgreSQL is exposed on `5432`, Valkey on `6379`, MinIO on `9000`, and the MinIO console on `9001`.

## Database

The database schema is PostgreSQL-only and is defined in [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma). It contains account, session, account-owned token, package, version, archive metadata, file index, dependency, publisher, permission, import, analysis, score, search, and audit tables.

### Local PostgreSQL bootstrap

Requirements: Docker Desktop (or PostgreSQL 17+ installed locally), Node.js 22+, and pnpm 10+.

1. Create the local environment file and start only PostgreSQL:

```bash
cp .env.example .env
docker compose up -d postgres
docker compose ps postgres
```

Wait until the service is `healthy`. The local default connection is:

```text
postgresql://private_pub:private_pub@localhost:5432/private_pub?schema=public
```

2. Export the connection string for Prisma commands. This is explicit so commands work regardless of the directory from which Prisma loads `.env`:

```bash
export DATABASE_URL='postgresql://private_pub:private_pub@localhost:5432/private_pub?schema=public'
```

3. Generate Prisma Client and create the table migration on the first local setup:

```bash
pnpm db:generate
pnpm --filter @private-pub/database exec prisma migrate dev --name create_registry_tables
```

The committed `202607170001_init` migration enables the PostgreSQL `pg_trgm` extension. The command above creates and applies the follow-up migration containing the tables declared in `schema.prisma`. Commit that new migration when it is intended to be shared with the team.

4. Optionally insert the sample publisher and package:

```bash
pnpm db:seed
```

5. Verify the result:

```bash
pnpm --filter @private-pub/database exec prisma migrate status
docker compose exec postgres psql -U private_pub -d private_pub -c '\dt'
pnpm --filter @private-pub/database exec prisma studio
```

Prisma Studio opens a local database browser; stop it with `Ctrl+C` when finished.

### Routine development commands

After the initial setup, use these commands when the Prisma schema changes:

```bash
export DATABASE_URL='postgresql://private_pub:private_pub@localhost:5432/private_pub?schema=public'
pnpm --filter @private-pub/database exec prisma migrate dev --name describe_the_change
pnpm db:generate
pnpm db:seed
```

Use a descriptive snake_case migration name, for example `add_package_visibility`. Do not edit an already-applied migration; add a new one instead.

### Applying migrations in a deployed environment

CI or production must only apply migrations already committed to Git. It must not run `prisma migrate dev`:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public'
pnpm --filter @private-pub/database exec prisma migrate deploy
pnpm --filter @private-pub/database exec prisma migrate status
```

Use a secret manager or deployment environment variable for the production URL. Never commit production credentials into `.env`.

### Resetting a local database

Only use this for disposable local data; it removes all tables and records from `private_pub`:

```bash
export DATABASE_URL='postgresql://private_pub:private_pub@localhost:5432/private_pub?schema=public'
pnpm --filter @private-pub/database exec prisma migrate reset
```

To remove Docker's PostgreSQL volume entirely, stop the stack and remove the named volume. This also permanently deletes local database data:

```bash
docker compose down --volumes
```

### Current application persistence mode

Set `DEMO_MODE=false` to make the API use `PrismaRegistryRepository`. Package metadata, versions, dependencies, file indexes, scores, imports, API tokens, retractions, and discontinue state are then read from and written to PostgreSQL. Archive binaries and text previews remain in `ARCHIVE_STORAGE_DIR`; the S3 adapter is still a separate production-hardening step.

The API and Web both load the monorepo root `.env` during local development. After changing `DEMO_MODE`, restart both processes and verify the active repository:

```bash
curl http://localhost:4000/health
```

The response must contain `"mode":"database"`. In database mode the Web app does not use its built-in demo fallback, so an unavailable API is surfaced as an error instead of showing local sample packages.

### Tài khoản quản trị và token

Khi chạy ở database mode và bảng `accounts` chưa có dữ liệu, API tự tạo tài khoản quyền cao nhất với thông tin mặc định:

```text
username: admin
password: admin
```

Mở `http://localhost:3000/login`, đăng nhập và đổi mật khẩu ngay. Tài khoản mặc định có cờ `must_change_password`, vì vậy API từ chối tạo/quản lý token và các thao tác ghi cho tới khi mật khẩu được đổi. Có thể thay thông tin bootstrap lần đầu bằng `DEFAULT_ADMIN_USERNAME` và `DEFAULT_ADMIN_PASSWORD`; các biến này không ghi đè tài khoản đã tồn tại.

Quản trị viên tạo tài khoản mới tại `http://localhost:3000/admin`. Mật khẩu nhập ở đây là mật khẩu tạm thời; tài khoản mới luôn được gắn cờ bắt buộc đổi mật khẩu. Người dùng có thể đổi mật khẩu bất kỳ lúc nào tại `http://localhost:3000/account`. Chỉ `super_admin` được tạo thêm tài khoản `admin` hoặc `super_admin`; tài khoản `admin` thông thường chỉ được tạo vai trò `user`.

Trang `http://localhost:3000/flutter` cung cấp trình tra cứu release Flutter theo tinh thần Sidekick. Dữ liệu được đọc từ kho release chính thức của Flutter và cache một giờ ở phía Next.js; có thể lọc theo Windows/macOS/Linux, stable/beta/dev, phiên bản Flutter, Dart SDK hoặc commit hash.

Session đăng nhập được lưu ở cookie HttpOnly, `SameSite=Lax`, có thời hạn theo `SESSION_TTL_HOURS`. Đặt `COOKIE_SECURE=true` khi cả Web và API được phục vụ qua HTTPS. PAT được gắn với `account_id`; trang Tokens chỉ liệt kê và cho thu hồi token thuộc tài khoản hiện tại. Mật khẩu, session và PAT không được lưu dạng rõ trong PostgreSQL.

## Dart CLI flow

Đăng nhập Web, tạo PAT ở trang Tokens và copy giá trị đầy đủ ngay khi nó xuất hiện. Khi tạo token, có thể bật **Không hết hạn**; token đó chỉ mất hiệu lực khi bị thu hồi, tài khoản bị khóa/xóa, hoặc token pepper bị thay đổi. Sau đó thêm token vào Dart:

```bash
dart pub token add http://localhost:4000
# Khi hiện "Enter secret token:", dán token pp_... rồi nhấn Enter.
# Không nhập pp_... trực tiếp tại dấu nhắc zsh.
```

Use either a repository declaration in `pubspec.yaml`:

```yaml
dependencies:
  aurora_ui:
    hosted: http://localhost:4000
    version: ^2.3.1
```

or set `PUB_HOSTED_URL=http://localhost:4000` for a controlled environment. In demo mode, newly published archives are parsed, indexed, and stored under `DEMO_STORAGE_DIR` (default `.private-pub-data/archives`) so they remain available across API restarts. Seeded historical archives return `501` until an `S3ArchiveStore` is configured.

## API overview

Hosted Pub surface:

```text
GET  /api/packages/:name
GET  /api/packages/:name/versions/:version
GET  /api/packages/:name/versions/:version.tar.gz
GET  /api/packages/versions/new
POST /api/uploads/:uploadId
GET  /api/packages/versions/newUploadFinish
```

Control plane:

```text
POST   /v1/auth/login
GET    /v1/auth/me
POST   /v1/auth/logout
PATCH  /v1/auth/password
GET    /v1/admin/accounts
POST   /v1/admin/accounts
GET    /v1/search
GET    /v1/packages/:name
GET    /v1/packages/:name/versions/:version
GET    /v1/packages/:name/versions/:version/files
GET    /v1/packages/:name/versions/:version/files/*path
GET    /v1/packages/:name/versions/:version/score
POST   /v1/imports/pubdev
POST   /v1/imports/file
GET    /v1/imports/:jobId
POST   /v1/analyses/recompute
POST   /v1/tokens
GET    /v1/tokens
DELETE /v1/tokens/:id
POST   /v1/packages/:name/versions/:version/retract
POST   /v1/packages/:name/versions/:version/restore
POST   /v1/packages/:name/discontinue
POST   /v1/packages/:name/undiscontinue
```

## Quality checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

The API suite covers Hosted Pub metadata, search ranking, retraction/restore, traversal, symlink escape, and valid archive indexes. The worker suite covers the full mock pipeline and score deductions.

## Production hardening roadmap

Before an internet-facing deployment:

1. Move local archive/text-preview storage from `ARCHIVE_STORAGE_DIR` to an `S3ArchiveStore` with short-lived signed upload/download URLs and immutable object keys.
2. Add database-backed publisher ownership checks and per-package authorization to every administrative mutation.
3. Parse and index `.tar.gz` archives in an isolated runner with compressed/uncompressed limits, entry limits, timeouts, no network, read-only root filesystem, and constrained CPU/memory.
4. Connect a durable queue (Valkey/BullMQ, Temporal, or a cloud queue), idempotency keys, retries, poison-job handling, and worker leases.
5. Add optional OIDC/JWKS/SSO integration, account lifecycle administration, MFA, recovery codes, token-pepper rotation, and secret-manager integration.
6. Run real `pana`/Dart/Flutter tools in pinned container images and persist logs/findings. Add ClamAV or a supply-chain scanner behind `malware-scan`.
7. Add signed provenance/SBOM verification, dependency-policy gates, domain verification for publishers, and approval workflows.
8. Add Playwright E2E tests, real `dart pub get/publish` contract tests, load tests, metrics/traces, backups, disaster-recovery drills, and CDN cache rules.

The modular-monolith boundaries are intentional: repositories, archive storage, auth, importer, analyzer steps, malware scanning, signature verification, and provenance verification can be replaced independently before splitting services.
