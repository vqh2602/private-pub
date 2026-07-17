import type { PackageDetail, PackageFile, PackageSummary, PackageVersion, Score } from "@private-pub/contracts";

const now = "2026-07-16T08:30:00.000Z";

export const score: Score = {
  grantedPoints: 148,
  maxPoints: 160,
  qualityScore: 0.92,
  popularityScore: 0.71,
  maintenanceScore: 0.88,
  tags: ["sdk:flutter", "platform:web", "license:mit", "null-safety"],
  breakdown: [
    { label: "File conventions", points: 30, max: 30, status: "pass" },
    { label: "Documentation", points: 27, max: 30, status: "warn" },
    { label: "Platform support", points: 30, max: 30, status: "pass" },
    { label: "Static analysis", points: 39, max: 40, status: "pass" },
    { label: "Dependency freshness", points: 22, max: 30, status: "warn" }
  ]
};

const version = (value: string, daysAgo: number, prerelease = false, sourceType: "native" | "pubdev_import" = "native"): PackageVersion => ({
  version: value,
  pubspec: {
    name: "aurora_ui",
    version: value,
    description: "Accessible design system for company Flutter apps",
    homepage: "https://example.com/aurora-ui",
    repository: "https://github.com/example/aurora-ui",
    environment: { sdk: ">=3.4.0 <4.0.0", flutter: ">=3.22.0" },
    dependencies: { flutter: { sdk: "flutter" }, collection: "^1.19.0" }
  },
  publishedAt: new Date(Date.parse(now) - daysAgo * 86_400_000).toISOString(),
  sdk: { dart: ">=3.4.0 <4.0.0", flutter: ">=3.22.0" },
  platforms: ["android", "ios", "web", "linux", "macos", "windows"],
  archiveSha256: `0a4cc3d8f1${value.replace(/\D/g, "").padEnd(54, "e")}`.slice(0, 64),
  retractedAt: null,
  prerelease,
  sourceType
});

export const files: PackageFile[] = [
  { path: "README.md", type: "file", size: 5820, language: "markdown", preview: "markdown", content: "# Aurora UI\n\nA calm, accessible design system for internal Flutter products.\n\n## Features\n\n- WCAG-aware components\n- Theme tokens\n- Responsive foundations" },
  { path: "CHANGELOG.md", type: "file", size: 1230, language: "markdown", preview: "markdown", content: "# Changelog\n\n## 2.3.1\n\n- Improved focus states.\n- Added adaptive navigation rail." },
  { path: "pubspec.yaml", type: "file", size: 814, language: "yaml", preview: "structured", content: "name: aurora_ui\nversion: 2.3.1\ndescription: Accessible design system\nenvironment:\n  sdk: '>=3.4.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter" },
  { path: "lib/", type: "dir" },
  { path: "lib/aurora_ui.dart", type: "file", size: 620, language: "dart", preview: "code", content: "library aurora_ui;\n\nexport 'src/theme.dart';\nexport 'src/button.dart';" },
  { path: "lib/src/", type: "dir" },
  { path: "lib/src/button.dart", type: "file", size: 2100, language: "dart", preview: "code", content: "import 'package:flutter/material.dart';\n\nclass AuroraButton extends StatelessWidget {\n  const AuroraButton({super.key, required this.label, this.onPressed});\n  final String label;\n  final VoidCallback? onPressed;\n\n  @override\n  Widget build(BuildContext context) => FilledButton(\n    onPressed: onPressed,\n    child: Text(label),\n  );\n}" },
  { path: "assets/", type: "dir" },
  { path: "assets/aurora-mark.png", type: "file", size: 18400, language: "image", preview: "image" }
];

const summaries: PackageSummary[] = [
  { name: "aurora_ui", publisherId: "platform.internal", description: "Accessible design system for company Flutter apps", latestVersion: "2.3.1", isDiscontinued: false, topics: ["flutter", "design-system", "a11y"], updatedAt: now, downloads30d: 4212, score: 148, hasPreview: true },
  { name: "secure_storage_plus", publisherId: "security.internal", description: "Opinionated encrypted storage with key rotation", latestVersion: "1.8.0", isDiscontinued: false, topics: ["flutter", "security", "storage"], updatedAt: "2026-07-11T09:00:00.000Z", downloads30d: 2890, score: 154, hasPreview: true },
  { name: "analytics_bridge", publisherId: "data.internal", description: "Unified analytics contract for mobile and web", latestVersion: "4.1.2", isDiscontinued: false, topics: ["dart", "analytics"], updatedAt: "2026-06-30T10:00:00.000Z", downloads30d: 1965, score: 142, hasPreview: true },
  { name: "legacy_networking", publisherId: "platform.internal", description: "Deprecated networking facade; migrate to network_core", latestVersion: "0.9.8", isDiscontinued: true, topics: ["dart", "network"], updatedAt: "2025-12-04T10:00:00.000Z", downloads30d: 218, score: 96, hasPreview: false }
];

export const demoDetails = new Map<string, PackageDetail>();
for (const item of summaries) {
  const versions = item.name === "aurora_ui"
    ? [version("2.3.1", 0), version("2.3.0", 17), version("2.2.0", 51), version("2.4.0-beta.1", 4, true)]
    : [version(item.latestVersion, 8, false, item.name === "analytics_bridge" ? "pubdev_import" : "native")];
  demoDetails.set(item.name, {
    package: item,
    latestVersion: versions[0]!,
    versions,
    requirements: {
      dartSdkConstraint: ">=3.4.0 <4.0.0",
      dartSdkMinimum: "3.4.0",
      flutterConstraint: item.topics.includes("flutter") ? ">=3.22.0" : null,
      flutterMinimum: item.topics.includes("flutter") ? "3.22.0" : null
    },
    dependencies: item.name === "aurora_ui" ? [
      { name: "flutter", constraint: "SDK", scope: "dependencies", source: "sdk", registry: "sdk" },
      { name: "analytics_bridge", constraint: "^4.1.2", scope: "dependencies", source: "hosted", registry: "private" },
      { name: "collection", constraint: "^1.19.0", scope: "dependencies", source: "hosted", registry: "pubdev" },
      { name: "equatable", constraint: "^2.0.7", scope: "dependencies", source: "hosted", registry: "pubdev" },
      { name: "meta", constraint: "^1.16.0", scope: "dependencies", source: "hosted", registry: "pubdev" },
      { name: "flutter_test", constraint: "SDK", scope: "dev_dependencies", source: "sdk", registry: "sdk" },
      { name: "flutter_lints", constraint: "^5.0.0", scope: "dev_dependencies", source: "hosted", registry: "pubdev" }
    ] : [
      { name: item.topics.includes("flutter") ? "flutter" : "meta", constraint: item.topics.includes("flutter") ? "SDK" : "^1.16.0", scope: "dependencies", source: item.topics.includes("flutter") ? "sdk" : "hosted", registry: item.topics.includes("flutter") ? "sdk" : "pubdev" }
    ],
    score: { ...score, grantedPoints: item.score },
    readme: item.name === "aurora_ui" ? files[0]!.content! : `# ${item.name}\n\n${item.description}`,
    changelog: item.name === "aurora_ui" ? files[1]!.content! : `# Changelog\n\n## ${item.latestVersion}\n\nInitial internal release.`,
    files: item.name === "aurora_ui" ? structuredClone(files) : files.slice(0, 3)
  });
}
