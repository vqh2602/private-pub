-- DropIndex
DROP INDEX "search_documents_description_trgm_idx";

-- DropIndex
DROP INDEX "search_documents_name_trgm_idx";

-- DropIndex
DROP INDEX "search_documents_platforms_json_idx";

-- CreateTable
CREATE TABLE "pending_uploads" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_username" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archive_path" TEXT,
    "temporary_directory" TEXT,
    "filename" TEXT,
    "uploaded_at" TIMESTAMP(3),

    CONSTRAINT "pending_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_oauth_codes" (
    "code" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "username" TEXT,
    "role" TEXT,
    "scopes_json" JSONB NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_oauth_codes_pkey" PRIMARY KEY ("code")
);
