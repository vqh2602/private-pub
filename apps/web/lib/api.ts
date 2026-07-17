import type { PackageDetail, PackageSummary, RegistryStats } from "@private-pub/contracts";

const serverApi = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const allowDemoFallback = process.env.DEMO_MODE !== "false";

export interface PackageFilters {
  sdk?: string[];
  platform?: string[];
  hasPreview?: boolean;
  verifiedPublisher?: boolean;
  minScore?: number;
}

export async function searchPackages(q = "", sort = "relevance", filters: PackageFilters = {}): Promise<PackageSummary[]> {
  const query = new URLSearchParams({ q, sort });
  filters.sdk?.forEach((value) => query.append("sdk", value));
  filters.platform?.forEach((value) => query.append("platform", value));
  if (filters.hasPreview !== undefined) query.set("hasPreview", String(filters.hasPreview));
  if (filters.verifiedPublisher !== undefined) query.set("verifiedPublisher", String(filters.verifiedPublisher));
  if (filters.minScore !== undefined) query.set("minScore", String(filters.minScore));
  try {
    const response = await fetch(`${serverApi}/v1/search?${query}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()).items;
  } catch (error) {
    if (!allowDemoFallback) throw error;
    return fallbackPackages.filter((item) => {
      const sdk = item.topics.includes("flutter") ? "flutter" : "dart";
      return `${item.name} ${item.description} ${item.topics.join(" ")}`.toLowerCase().includes(q.toLowerCase()) && (!filters.sdk?.length || filters.sdk.includes(sdk)) && (!filters.platform?.length || filters.platform.some((platform) => platform === "web" || platform === "desktop" || (sdk === "flutter" && ["android", "ios", "linux", "macos", "windows"].includes(platform)))) && (filters.hasPreview === undefined || item.hasPreview === filters.hasPreview) && (filters.verifiedPublisher === undefined || filters.verifiedPublisher) && (filters.minScore === undefined || item.score >= filters.minScore);
    });
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
    if (!allowDemoFallback) throw error;
    return {
      packages: fallbackPackages.length,
      versions: fallbackPackages.length,
      analyzedVersions: fallbackPackages.length,
    };
  }
}

export async function getPackage(name: string): Promise<PackageDetail | null> {
  try {
    const response = await fetch(`${serverApi}/v1/packages/${name}`, {
      cache: "no-store",
    });
    return response.ok ? response.json() : null;
  } catch (error) {
    if (!allowDemoFallback) throw error;
    return name === fallbackDetail.package.name ? fallbackDetail : null;
  }
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
  archiveSha256: "0a4cc3d8f1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
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
  readme: "# Aurora UI\n\nA calm, accessible design system for internal Flutter products.",
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
