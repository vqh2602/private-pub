# Constellation — private Dart/Flutter registry

Constellation is a production-oriented monorepo scaffold for a private Dart and Flutter package registry. It exposes a Hosted Pub Repository API V2 surface for `dart pub` and a separate control-plane API for the web app, administration, imports, code exploration, analysis, and scoring.

The repository runs immediately in demo mode with deterministic data. PostgreSQL, Valkey, MinIO, OIDC, durable queues, and real Dart/Flutter analyzers are represented by explicit adapters and schema boundaries; production integrations are deliberately not presented as complete where credentials or isolated infrastructure are required.

## What is implemented

- Modern Next.js UI with package search, filters, package details, versions, score breakdown, publishers, import wizard, token management, and administration.
- Historical file explorer with file tree, Markdown preview, structured pubspec preview, source viewer, raw view, simple version diff, and graceful binary fallback.
- Fastify API with separate `/api/packages/...` and `/v1/...` surfaces.
- Hosted Pub V2 package/version metadata, archive URL resolution, upload negotiation, upload adapter endpoint, and finalization endpoint.
- Control-plane routes for search, packages, files, scores, imports, analyses, PATs, retract/restore, and discontinue/undiscontinue.
- Scoped bearer-token middleware, one-time PAT plaintext response, SHA-256 token hashing with a server-side pepper, rate limits, CSP, and security headers.
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

With PostgreSQL running:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

The first migration enables `pg_trgm`; Prisma owns the table definitions in `packages/database/prisma/schema.prisma`. Search v1 can combine PostgreSQL full-text vectors with trigram similarity. The current demo repository is intentionally in memory so UI/API development does not require a database; implement `PrismaRegistryRepository` behind the existing `RegistryRepository` interface to switch persistence.

## Dart CLI flow

Create a PAT from the Tokens page or API, then add it to Dart:

```bash
curl -X POST http://localhost:4000/v1/tokens \
  -H 'Authorization: Bearer demo-admin-token' \
  -H 'Content-Type: application/json' \
  -d '{"name":"local-cli","scopes":["packages:read","packages:publish"],"expiresInDays":30}'

dart pub token add http://localhost:4000
```

Use either a repository declaration in `pubspec.yaml`:

```yaml
dependencies:
  aurora_ui:
    hosted: http://localhost:4000
    version: ^2.3.1
```

or set `PUB_HOSTED_URL=http://localhost:4000` for a controlled environment. The demo archive download route returns `501` until an `S3ArchiveStore` is configured; metadata, search, and upload negotiation are available.

## API overview

Hosted Pub surface:

```text
GET  /api/packages/:name
GET  /api/packages/:name/versions/:version
GET  /api/packages/:name/versions/:version.tar.gz
GET  /api/packages/versions/newUpload
POST /api/uploads/:uploadId
GET  /api/packages/versions/newUploadFinish
```

Control plane:

```text
GET    /v1/search
GET    /v1/packages/:name
GET    /v1/packages/:name/versions/:version
GET    /v1/packages/:name/versions/:version/files
GET    /v1/packages/:name/versions/:version/files/*path
GET    /v1/packages/:name/versions/:version/score
POST   /v1/imports/pubdev
GET    /v1/imports/:jobId
POST   /v1/analyses/recompute
POST   /v1/tokens
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

1. Implement `PrismaRegistryRepository`, transactional publish/version creation, semver latest selection, and audit writes.
2. Implement `S3ArchiveStore` with short-lived signed upload/download URLs, immutable object keys, and verified SHA-256 checksums.
3. Parse and index `.tar.gz` archives in an isolated runner with compressed/uncompressed limits, entry limits, timeouts, no network, read-only root filesystem, and constrained CPU/memory.
4. Connect a durable queue (Valkey/BullMQ, Temporal, or a cloud queue), idempotency keys, retries, poison-job handling, and worker leases.
5. Replace demo auth with OIDC/JWKS verification and database-backed PAT validation; rotate the token pepper and add secret-manager integration.
6. Run real `pana`/Dart/Flutter tools in pinned container images and persist logs/findings. Add ClamAV or a supply-chain scanner behind `malware-scan`.
7. Add signed provenance/SBOM verification, dependency-policy gates, domain verification for publishers, and approval workflows.
8. Add Playwright E2E tests, real `dart pub get/publish` contract tests, load tests, metrics/traces, backups, disaster-recovery drills, and CDN cache rules.

The modular-monolith boundaries are intentional: repositories, archive storage, auth, importer, analyzer steps, malware scanning, signature verification, and provenance verification can be replaced independently before splitting services.
