import type { PackageDetail, PackageSummary } from "@private-pub/contracts";

const serverApi = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function searchPackages(q = "", sort = "relevance"): Promise<PackageSummary[]> {
  try {
    const response = await fetch(`${serverApi}/v1/search?q=${encodeURIComponent(q)}&sort=${sort}`, { next: { revalidate: 30 } });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()).items;
  } catch {
    return fallbackPackages.filter((item) => `${item.name} ${item.description} ${item.topics.join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  }
}

export async function getPackage(name: string): Promise<PackageDetail | null> {
  try {
    const response = await fetch(`${serverApi}/v1/packages/${name}`, { next: { revalidate: 30 } });
    return response.ok ? response.json() : null;
  } catch { return name === fallbackDetail.package.name ? fallbackDetail : null; }
}

const fallbackPackages: PackageSummary[] = [
  { name: "aurora_ui", publisherId: "platform.internal", description: "Accessible design system for company Flutter apps", latestVersion: "2.3.1", isDiscontinued: false, topics: ["flutter", "design-system", "a11y"], updatedAt: "2026-07-16T08:30:00.000Z", downloads30d: 4212, score: 148, hasPreview: true },
  { name: "secure_storage_plus", publisherId: "security.internal", description: "Opinionated encrypted storage with key rotation", latestVersion: "1.8.0", isDiscontinued: false, topics: ["flutter", "security"], updatedAt: "2026-07-11T09:00:00.000Z", downloads30d: 2890, score: 154, hasPreview: true }
];

const v = { version: "2.3.1", publishedAt: "2026-07-16T08:30:00.000Z", sdk: { dart: ">=3.4.0 <4.0.0", flutter: ">=3.22.0" }, platforms: ["android", "ios", "web", "linux", "macos", "windows"], archiveSha256: "0a4cc3d8f1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", retractedAt: null, prerelease: false, sourceType: "native" as const };
const fallbackDetail: PackageDetail = {
  package: fallbackPackages[0]!, latestVersion: v, versions: [v],
  requirements: { dartSdkConstraint: ">=3.4.0 <4.0.0", dartSdkMinimum: "3.4.0", flutterConstraint: ">=3.22.0", flutterMinimum: "3.22.0" },
  dependencies: [
    { name: "flutter", constraint: "SDK", scope: "dependencies", source: "sdk", registry: "sdk" },
    { name: "analytics_bridge", constraint: "^4.1.2", scope: "dependencies", source: "hosted", registry: "private" },
    { name: "collection", constraint: "^1.19.0", scope: "dependencies", source: "hosted", registry: "pubdev" },
    { name: "equatable", constraint: "^2.0.7", scope: "dependencies", source: "hosted", registry: "pubdev" },
    { name: "meta", constraint: "^1.16.0", scope: "dependencies", source: "hosted", registry: "pubdev" }
  ],
  score: { grantedPoints: 148, maxPoints: 160, qualityScore: .92, popularityScore: .71, maintenanceScore: .88, tags: ["sdk:flutter", "platform:web", "license:mit"], breakdown: [{ label: "Documentation", points: 27, max: 30, status: "warn" }, { label: "Static analysis", points: 39, max: 40, status: "pass" }] },
  readme: "# Aurora UI\n\nA calm, accessible design system for internal Flutter products.", changelog: "# Changelog\n\n## 2.3.1\n\nImproved focus states.",
  files: [{ path: "README.md", type: "file", size: 5820, language: "markdown", preview: "markdown", content: "# Aurora UI\n\nA calm, accessible design system." }, { path: "pubspec.yaml", type: "file", size: 814, language: "yaml", preview: "structured", content: "name: aurora_ui\nversion: 2.3.1" }, { path: "lib/", type: "dir" }, { path: "lib/aurora_ui.dart", type: "file", size: 620, language: "dart", preview: "code", content: "library aurora_ui;\n\nexport 'src/button.dart';" }]
};
