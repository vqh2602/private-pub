import type {
  PackageDetail,
  PackageFile,
  PackageSummary,
  RegistryStats,
  SearchResponse,
} from "@private-pub/contracts";

const serverApi =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";
const allowDemoFallback = process.env.DEMO_MODE !== "false";

export interface PackageFilters {
  sdk?: string[];
  platform?: string[];
  hasPreview?: boolean;
  verifiedPublisher?: boolean;
  minScore?: number;
  publisher?: string;
}

export async function searchPackages(
  q = "",
  sort = "relevance",
  filters: PackageFilters = {},
  page = 1,
  limit = 20,
): Promise<SearchResponse> {
  const query = new URLSearchParams({
    q,
    sort,
    page: String(page),
    limit: String(limit),
  });
  filters.sdk?.forEach((value) => query.append("sdk", value));
  filters.platform?.forEach((value) => query.append("platform", value));
  if (filters.hasPreview !== undefined)
    query.set("hasPreview", String(filters.hasPreview));
  if (filters.verifiedPublisher !== undefined)
    query.set("verifiedPublisher", String(filters.verifiedPublisher));
  if (filters.minScore !== undefined)
    query.set("minScore", String(filters.minScore));
  if (filters.publisher) query.set("publisher", filters.publisher);
  try {
    const response = await fetch(`${serverApi}/v1/search?${query}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  } catch (error) {
    if (!allowDemoFallback) throw registryApiUnavailable(error);
    const items = fallbackPackages.filter((item) => {
      const sdk = item.topics.includes("flutter") ? "flutter" : "dart";
      return (
        `${item.name} ${item.description} ${item.topics.join(" ")}`
          .toLowerCase()
          .includes(q.toLowerCase()) &&
        (!filters.sdk?.length || filters.sdk.includes(sdk)) &&
        (!filters.platform?.length ||
          filters.platform.some(
            (platform) =>
              platform === "web" ||
              platform === "desktop" ||
              (sdk === "flutter" &&
                ["android", "ios", "linux", "macos", "windows"].includes(
                  platform,
                )),
          )) &&
        (filters.hasPreview === undefined ||
          item.hasPreview === filters.hasPreview) &&
        (filters.verifiedPublisher === undefined ||
          filters.verifiedPublisher) &&
        (filters.minScore === undefined || item.score >= filters.minScore) &&
        (!filters.publisher || item.publisherId === filters.publisher)
      );
    });
    return {
      items: items.slice((page - 1) * limit, page * limit),
      total: items.length,
      page,
      limit,
    };
  }
}

export async function getRegistryStats(): Promise<RegistryStats> {
  try {
    const response = await fetch(`${serverApi}/v1/stats`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  } catch (error) {
    if (!allowDemoFallback) throw registryApiUnavailable(error);
    return {
      packages: fallbackPackages.length,
      versions: fallbackPackages.length,
      analyzedVersions: fallbackPackages.length,
    };
  }
}

export async function getPackage(
  name: string,
  options: { includeVersions?: boolean; includeFiles?: boolean } = {},
): Promise<PackageDetail | null> {
  const query = new URLSearchParams();
  if (options.includeVersions !== undefined)
    query.set("includeVersions", String(options.includeVersions));
  if (options.includeFiles !== undefined)
    query.set("includeFiles", String(options.includeFiles));
  try {
    const response = await fetch(
      `${serverApi}/v1/packages/${encodeURIComponent(name)}${query.size ? `?${query}` : ""}`,
      { cache: "no-store" },
    );
    return response.ok ? response.json() : null;
  } catch (error) {
    if (!allowDemoFallback) throw registryApiUnavailable(error);
    if (name !== fallbackDetail.package.name) return null;
    return {
      ...fallbackDetail,
      versions:
        options.includeVersions === false ? [] : fallbackDetail.versions,
      files: options.includeFiles === false ? [] : fallbackDetail.files,
    };
  }
}

export async function getPackageFiles(
  name: string,
  version: string,
): Promise<PackageFile[] | null> {
  try {
    const response = await fetch(
      `${serverApi}/v1/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/files`,
      { cache: "no-store" },
    );
    return response.ok ? response.json() : null;
  } catch (error) {
    if (!allowDemoFallback) throw registryApiUnavailable(error);
    return name === fallbackDetail.package.name && version === v.version
      ? fallbackDetail.files
      : null;
  }
}

function registryApiUnavailable(cause: unknown) {
  if (
    cause instanceof Error &&
    "digest" in cause &&
    cause.digest === "DYNAMIC_SERVER_USAGE"
  )
    return cause;
  return new Error(
    "Registry API is unavailable. Start it with `pnpm dev` and ensure database migrations are applied.",
    { cause },
  );
}

const fallbackPackages: PackageSummary[] = [
  {
    name: "aurora_ui",
    publisherId: "platform.internal",
    description: "Accessible design system for company Flutter apps",
    latestVersion: "2.3.1",
    isDiscontinued: false,
    topics: ["flutter", "design-system", "a11y"],
    updatedAt: "2026-07-16T08:30:00.000Z",
    downloads30d: 4212,
    score: 148,
    hasPreview: true,
  },
  {
    name: "secure_storage_plus",
    publisherId: "security.internal",
    description: "Opinionated encrypted storage with key rotation",
    latestVersion: "1.8.0",
    isDiscontinued: false,
    topics: ["flutter", "security"],
    updatedAt: "2026-07-11T09:00:00.000Z",
    downloads30d: 2890,
    score: 154,
    hasPreview: true,
  },
];

const v = {
  version: "2.3.1",
  pubspec: {
    name: "aurora_ui",
    version: "2.3.1",
    homepage: "https://example.com/aurora-ui",
    repository: "https://github.com/example/aurora-ui",
    environment: { sdk: ">=3.4.0 <4.0.0", flutter: ">=3.22.0" },
    dependencies: { flutter: { sdk: "flutter" } },
  },
  publishedAt: "2026-07-16T08:30:00.000Z",
  publishedBy: "platform-team",
  sdk: { dart: ">=3.4.0 <4.0.0", flutter: ">=3.22.0" },
  platforms: ["android", "ios", "web", "linux", "macos", "windows"],
  archiveSha256:
    "0a4cc3d8f1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  retractedAt: null,
  prerelease: false,
  releaseChannel: "stable" as const,
  sourceType: "native" as const,
};
const fallbackDetail: PackageDetail = {
  package: fallbackPackages[0]!,
  latestVersion: v,
  versions: [v],
  requirements: {
    dartSdkConstraint: ">=3.4.0 <4.0.0",
    dartSdkMinimum: "3.4.0",
    flutterConstraint: ">=3.22.0",
    flutterMinimum: "3.22.0",
  },
  dependencies: [
    {
      name: "flutter",
      constraint: "SDK",
      scope: "dependencies",
      source: "sdk",
      registry: "sdk",
    },
    {
      name: "analytics_bridge",
      constraint: "^4.1.2",
      scope: "dependencies",
      source: "hosted",
      registry: "private",
    },
    {
      name: "collection",
      constraint: "^1.19.0",
      scope: "dependencies",
      source: "hosted",
      registry: "pubdev",
    },
    {
      name: "equatable",
      constraint: "^2.0.7",
      scope: "dependencies",
      source: "hosted",
      registry: "pubdev",
    },
    {
      name: "meta",
      constraint: "^1.16.0",
      scope: "dependencies",
      source: "hosted",
      registry: "pubdev",
    },
  ],
  score: {
    grantedPoints: 148,
    maxPoints: 160,
    qualityScore: 0.92,
    popularityScore: 0.71,
    maintenanceScore: 0.88,
    tags: ["sdk:flutter", "platform:web", "license:mit"],
    breakdown: [
      { label: "Documentation", points: 27, max: 30, status: "warn" },
      { label: "Static analysis", points: 39, max: 40, status: "pass" },
    ],
  },
  readme:
    "# Aurora UI\n\nA calm, accessible design system for internal Flutter products.",
  changelog: "# Changelog\n\n## 2.3.1\n\nImproved focus states.",
  files: [
    {
      path: "README.md",
      type: "file",
      size: 5820,
      language: "markdown",
      preview: "markdown",
      content: "# Aurora UI\n\nA calm, accessible design system.",
    },
    {
      path: "pubspec.yaml",
      type: "file",
      size: 814,
      language: "yaml",
      preview: "structured",
      content: "name: aurora_ui\nversion: 2.3.1",
    },
    { path: "lib/", type: "dir" },
    {
      path: "lib/aurora_ui.dart",
      type: "file",
      size: 620,
      language: "dart",
      preview: "code",
      content: "library aurora_ui;\n\nexport 'src/button.dart';",
    },
  ],
};
