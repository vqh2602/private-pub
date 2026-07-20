-- Preserve ownership for packages that predate publish authorization. The first
-- account-backed publisher becomes package admin; packages without a matching
-- account remain manageable by registry administrators.
INSERT INTO "package_permissions" (
  "package_id",
  "subject_type",
  "subject_id",
  "role",
  "granted_by"
)
SELECT
  package."id",
  'USER'::"SubjectType",
  account."id",
  'PACKAGE_ADMIN'::"PackageRole",
  account."id"
FROM "packages" AS package
JOIN LATERAL (
  SELECT version."published_by"
  FROM "package_versions" AS version
  WHERE version."package_id" = package."id"
    AND version."published_by" IS NOT NULL
  ORDER BY version."published_at" ASC
  LIMIT 1
) AS first_release ON true
JOIN "accounts" AS account
  ON account."username" = first_release."published_by"
WHERE NOT EXISTS (
  SELECT 1
  FROM "package_permissions" AS existing_permission
  WHERE existing_permission."package_id" = package."id"
)
ON CONFLICT ("package_id", "subject_type", "subject_id") DO NOTHING;

CREATE INDEX IF NOT EXISTS "package_permissions_subject_id_package_id_idx"
  ON "package_permissions"("subject_id", "package_id");
