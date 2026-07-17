CREATE TYPE "AccountRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

CREATE TABLE "accounts" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "AccountRole" NOT NULL DEFAULT 'USER',
  "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- This migration was originally added after the registry tables, despite its
-- timestamp sorting before them. Creating this one dependency idempotently
-- keeps both fresh installs and already-applied migration histories valid.
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

ALTER TABLE "api_tokens" ADD COLUMN "account_id" TEXT;
ALTER TABLE "api_tokens" ADD COLUMN "public_id" TEXT;
UPDATE "api_tokens" SET "public_id" = md5(random()::text || clock_timestamp()::text || "id"::text);
ALTER TABLE "api_tokens" ALTER COLUMN "public_id" SET NOT NULL;

CREATE UNIQUE INDEX "accounts_username_key" ON "accounts"("username");
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_account_id_expires_at_idx" ON "auth_sessions"("account_id", "expires_at");
CREATE INDEX "api_tokens_account_id_revoked_at_idx" ON "api_tokens"("account_id", "revoked_at");
CREATE UNIQUE INDEX "api_tokens_public_id_key" ON "api_tokens"("public_id");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
