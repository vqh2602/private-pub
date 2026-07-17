-- Keep the current package version referentially valid and cheap to join.
CREATE INDEX "packages_latest_version_id_idx" ON "packages"("latest_version_id");
ALTER TABLE "packages"
  ADD CONSTRAINT "packages_latest_version_id_fkey"
  FOREIGN KEY ("latest_version_id") REFERENCES "package_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Version score migrations are processed in bounded batches instead of scanning
-- every file and dependency on each API startup.
ALTER TABLE "scores" ADD COLUMN "calculation_version" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "scores_calculation_version_package_version_id_idx"
  ON "scores"("calculation_version", "package_version_id");

-- Search documents are deliberately denormalized: catalogue queries now filter,
-- sort and paginate one row per package without loading its full release history.
ALTER TABLE "search_documents"
  ADD COLUMN "sdk_kind" TEXT NOT NULL DEFAULT 'dart',
  ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "downloads_30d" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "has_preview" BOOLEAN NOT NULL DEFAULT false;

UPDATE "search_documents" AS document
SET
  "sdk_kind" = CASE
    WHEN version."pubspec_json" #> '{environment,flutter}' IS NOT NULL
      OR version."pubspec_json" #> '{dependencies,flutter}' IS NOT NULL
      OR version."pubspec_json" ? 'flutter'
    THEN 'flutter'
    ELSE 'dart'
  END,
  "score" = COALESCE(current_score."granted_points", 0),
  "downloads_30d" = COALESCE(current_score."download_count_30d", 0),
  "has_preview" = EXISTS (
    SELECT 1
    FROM "package_files" AS file
    WHERE file."package_version_id" = version."id"
      AND file."preview_status" = 'READY'
  )
FROM "package_versions" AS version
LEFT JOIN LATERAL (
  SELECT score."granted_points", score."download_count_30d"
  FROM "scores" AS score
  WHERE score."package_version_id" = version."id"
  ORDER BY score."computed_at" DESC
  LIMIT 1
) AS current_score ON true
WHERE document."package_version_id" = version."id";

CREATE INDEX "search_documents_publisher_id_idx" ON "search_documents"("publisher_id");
CREATE INDEX "search_documents_sdk_kind_idx" ON "search_documents"("sdk_kind");
CREATE INDEX "search_documents_score_name_idx" ON "search_documents"("score" DESC, "name");
CREATE INDEX "search_documents_downloads_30d_name_idx" ON "search_documents"("downloads_30d" DESC, "name");
CREATE INDEX "search_documents_updated_at_name_idx" ON "search_documents"("updated_at" DESC, "name");
CREATE INDEX "search_documents_platforms_json_idx" ON "search_documents" USING GIN ("platforms_json" jsonb_path_ops);
CREATE INDEX "search_documents_name_trgm_idx" ON "search_documents" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "search_documents_description_trgm_idx" ON "search_documents" USING GIN ("description" gin_trgm_ops);
