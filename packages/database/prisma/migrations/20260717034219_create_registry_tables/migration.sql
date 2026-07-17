-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'INTERNAL', 'PUBLIC');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('USER', 'GROUP', 'SERVICE_ACCOUNT');

-- CreateEnum
CREATE TYPE "PackageRole" AS ENUM ('PACKAGE_ADMIN', 'PACKAGE_WRITER', 'VIEWER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'FAILED', 'COMPLETED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('QUEUED', 'RUNNING', 'FAILED', 'COMPLETED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "PreviewStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "DependencyScope" AS ENUM ('DEPENDENCIES', 'DEV_DEPENDENCIES', 'DEPENDENCY_OVERRIDES');

-- CreateTable
CREATE TABLE "packages" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "description" TEXT,
    "latest_version_id" BIGINT,
    "publisher_id" BIGINT,
    "is_discontinued" BOOLEAN NOT NULL DEFAULT false,
    "replacement_package_id" BIGINT,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "topics" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_versions" (
    "id" BIGSERIAL NOT NULL,
    "package_id" BIGINT NOT NULL,
    "version" TEXT NOT NULL,
    "version_sort_key" TEXT NOT NULL,
    "pubspec_json" JSONB NOT NULL,
    "readme_html" TEXT,
    "changelog_html" TEXT,
    "license_expression" TEXT,
    "archive_object_key" TEXT NOT NULL,
    "archive_sha256" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "retracted_at" TIMESTAMP(3),
    "is_prerelease" BOOLEAN NOT NULL DEFAULT false,
    "source_type" TEXT NOT NULL DEFAULT 'native',
    "source_url" TEXT,
    "import_provenance_json" JSONB,

    CONSTRAINT "package_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_files" (
    "id" BIGSERIAL NOT NULL,
    "package_version_id" BIGINT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "mime_type" TEXT,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "is_text" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "preview_status" "PreviewStatus" NOT NULL DEFAULT 'PENDING',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "package_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependencies" (
    "id" BIGSERIAL NOT NULL,
    "package_version_id" BIGINT NOT NULL,
    "scope" "DependencyScope" NOT NULL,
    "name" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "hosted_url" TEXT,
    "constraint_raw" TEXT NOT NULL,
    "is_direct" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" BIGSERIAL NOT NULL,
    "package_version_id" BIGINT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    "runner_image" TEXT,
    "dart_sdk_version" TEXT,
    "flutter_sdk_version" TEXT,
    "pana_version" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "log_object_key" TEXT,
    "sandbox_type" TEXT,

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_findings" (
    "id" BIGSERIAL NOT NULL,
    "analysis_run_id" BIGINT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "file_path" TEXT,
    "line" INTEGER,
    "column" INTEGER,
    "raw_json" JSONB,

    CONSTRAINT "analysis_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" BIGSERIAL NOT NULL,
    "package_version_id" BIGINT NOT NULL,
    "granted_points" INTEGER NOT NULL,
    "max_points" INTEGER NOT NULL,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "download_count_30d" INTEGER NOT NULL DEFAULT 0,
    "quality_score" DOUBLE PRECISION NOT NULL,
    "popularity_score" DOUBLE PRECISION NOT NULL,
    "maintenance_score" DOUBLE PRECISION NOT NULL,
    "tags_json" JSONB NOT NULL,
    "weights_json" JSONB NOT NULL,
    "breakdown_json" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishers" (
    "id" BIGSERIAL NOT NULL,
    "publisher_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "contact_email" TEXT,
    "verification_method" TEXT,
    "domain" TEXT,
    "verified_at" TIMESTAMP(3),
    "metadata_json" JSONB,

    CONSTRAINT "publishers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_permissions" (
    "id" BIGSERIAL NOT NULL,
    "package_id" BIGINT NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "role" "PackageRole" NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" TEXT NOT NULL,

    CONSTRAINT "package_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_tokens" (
    "id" BIGSERIAL NOT NULL,
    "subject_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes_json" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "source_registry" TEXT NOT NULL,
    "package_name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_versions_json" JSONB NOT NULL,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "summary_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_documents" (
    "id" BIGSERIAL NOT NULL,
    "package_id" BIGINT NOT NULL,
    "package_version_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "readme_excerpt" TEXT,
    "topics_json" JSONB NOT NULL,
    "publisher_id" TEXT,
    "platforms_json" JSONB NOT NULL,
    "tags_json" JSONB NOT NULL,
    "ranking_features_json" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packages_name_key" ON "packages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "packages_normalized_name_key" ON "packages"("normalized_name");

-- CreateIndex
CREATE INDEX "package_versions_package_id_version_sort_key_idx" ON "package_versions"("package_id", "version_sort_key" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "package_versions_package_id_version_key" ON "package_versions"("package_id", "version");

-- CreateIndex
CREATE INDEX "package_files_package_version_id_path_idx" ON "package_files"("package_version_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "package_files_package_version_id_path_key" ON "package_files"("package_version_id", "path");

-- CreateIndex
CREATE INDEX "dependencies_package_version_id_scope_idx" ON "dependencies"("package_version_id", "scope");

-- CreateIndex
CREATE INDEX "scores_package_version_id_computed_at_idx" ON "scores"("package_version_id", "computed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "publishers_publisher_id_key" ON "publishers"("publisher_id");

-- CreateIndex
CREATE UNIQUE INDEX "package_permissions_package_id_subject_type_subject_id_key" ON "package_permissions"("package_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_tokens_subject_id_revoked_at_idx" ON "api_tokens"("subject_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "search_documents_package_id_key" ON "search_documents"("package_id");

-- CreateIndex
CREATE INDEX "search_documents_name_idx" ON "search_documents"("name");

-- CreateIndex
CREATE INDEX "audit_logs_subject_type_subject_id_created_at_idx" ON "audit_logs"("subject_type", "subject_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "publishers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_files" ADD CONSTRAINT "package_files_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_findings" ADD CONSTRAINT "analysis_findings_analysis_run_id_fkey" FOREIGN KEY ("analysis_run_id") REFERENCES "analysis_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_permissions" ADD CONSTRAINT "package_permissions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
