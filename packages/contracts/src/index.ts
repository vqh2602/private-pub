import { z } from "zod";

export const jobStatusSchema = z.enum(["queued", "running", "failed", "completed", "partial"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const packageFileSchema = z.object({
  path: z.string(),
  type: z.enum(["file", "dir"]),
  size: z.number().nonnegative().optional(),
  language: z.string().optional(),
  preview: z.enum(["markdown", "structured", "image", "code", "unsupported"]).optional(),
  content: z.string().optional()
});
export type PackageFile = z.infer<typeof packageFileSchema>;

export const scoreSchema = z.object({
  grantedPoints: z.number(),
  maxPoints: z.number(),
  qualityScore: z.number().min(0).max(1),
  popularityScore: z.number().min(0).max(1),
  maintenanceScore: z.number().min(0).max(1),
  tags: z.array(z.string()),
  breakdown: z.array(z.object({
    label: z.string(),
    points: z.number(),
    max: z.number(),
    status: z.enum(["pass", "warn", "fail"]),
    details: z.array(z.string()).optional()
  }))
});
export type Score = z.infer<typeof scoreSchema>;

export const releaseChannelSchema = z.enum(["stable", "rc", "beta", "alpha", "dev", "prerelease"]);
export type ReleaseChannel = z.infer<typeof releaseChannelSchema>;

export const packageVersionSchema = z.object({
  version: z.string(),
  pubspec: z.record(z.string(), z.unknown()),
  publishedAt: z.string().datetime(),
  publishedBy: z.string().nullable(),
  sdk: z.object({ dart: z.string(), flutter: z.string().optional() }),
  platforms: z.array(z.string()),
  archiveSha256: z.string(),
  retractedAt: z.string().datetime().nullable(),
  prerelease: z.boolean(),
  releaseChannel: releaseChannelSchema,
  sourceType: z.enum(["native", "pubdev_import"])
});
export type PackageVersion = z.infer<typeof packageVersionSchema>;

export const packageSummarySchema = z.object({
  name: z.string(),
  publisherId: z.string(),
  description: z.string(),
  latestVersion: z.string(),
  isDiscontinued: z.boolean(),
  topics: z.array(z.string()),
  updatedAt: z.string().datetime(),
  downloads30d: z.number(),
  score: z.number(),
  hasPreview: z.boolean()
});
export type PackageSummary = z.infer<typeof packageSummarySchema>;

export const packageDetailSchema = z.object({
  package: packageSummarySchema,
  latestVersion: packageVersionSchema,
  versions: z.array(packageVersionSchema),
  requirements: z.object({
    dartSdkConstraint: z.string(),
    dartSdkMinimum: z.string(),
    flutterConstraint: z.string().nullable(),
    flutterMinimum: z.string().nullable()
  }),
  dependencies: z.array(z.object({
    name: z.string(),
    constraint: z.string(),
    scope: z.enum(["dependencies", "dev_dependencies", "dependency_overrides"]),
    source: z.enum(["hosted", "sdk", "git", "path"]),
    registry: z.enum(["private", "pubdev", "sdk", "git", "path"])
  })),
  score: scoreSchema,
  readme: z.string(),
  changelog: z.string(),
  files: z.array(packageFileSchema)
});
export type PackageDetail = z.infer<typeof packageDetailSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  sdk: z.enum(["dart", "flutter", "any"]).default("any"),
  platform: z.string().optional(),
  publisher: z.string().optional(),
  hasPreview: z.coerce.boolean().optional(),
  includeRetracted: z.coerce.boolean().default(false),
  sort: z.enum(["relevance", "updated", "downloads", "score"]).default("relevance"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const importRequestSchema = z.object({
  packageName: z.string().regex(/^[a-z][a-z0-9_]*$/),
  versions: z.array(z.string()).min(1),
  mode: z.enum(["mirror", "snapshot", "sealed"]).default("snapshot"),
  importPublisher: z.boolean().default(true),
  importScoreSnapshot: z.boolean().default(true),
  verifyArchiveSha256: z.boolean().default(true),
  createFileIndex: z.boolean().default(true),
  createPreviewArtifacts: z.boolean().default(true)
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export const tokenRequestSchema = z.object({
  name: z.string().min(2).max(80),
  scopes: z.array(z.enum(["packages:read", "packages:publish", "packages:admin", "imports:write", "tokens:write"])).min(1),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(90)
});
export type TokenRequest = z.infer<typeof tokenRequestSchema>;
