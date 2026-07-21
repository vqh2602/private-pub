import type { Score } from "@private-pub/contracts";
import type { ParsedDependency, ParsedPackageArchive } from "./archive.js";
import type { AnalyzerFinding } from "./analyzer.js";

export const SCORE_WEIGHTS = {
  conventions: 30,
  documentation: 30,
  platforms: 30,
  analysis: 40,
  dependencies: 30,
} as const;

export interface PackageScoreInput {
  pubspec: Record<string, unknown>;
  description: string;
  readme: string;
  changelog: string;
  files: Array<{ path: string }>;
  dependencies: ParsedDependency[];
  downloads30d?: number;
  findings?: AnalyzerFinding[];
}

export function scoreParsedPackage(
  parsed: ParsedPackageArchive,
  downloads30d = 0,
  findings?: AnalyzerFinding[],
): Score {
  return calculatePackageScore({
    pubspec: parsed.pubspec,
    description: parsed.description,
    readme: parsed.readme,
    changelog: parsed.changelog,
    files: parsed.files,
    dependencies: parsed.dependencies,
    downloads30d,
    findings,
  });
}

export function calculatePackageScore(input: PackageScoreInput): Score {
  const paths = new Set(input.files.map((file) => normalizePath(file.path)));
  const hasPath = (candidate: string) =>
    paths.has(candidate) || paths.has(`${candidate}/`);
  const hasPrefix = (prefix: string) =>
    [...paths].some((path) => path.startsWith(prefix));
  const isFlutter = Boolean(
    record(input.pubspec.dependencies).flutter ||
    record(input.pubspec.environment).flutter ||
    input.pubspec.flutter,
  );
  const hasDescription = meaningful(input.description, 20);
  const hasLicense = [...paths].some((path) =>
    /^licen[cs]e(?:\.|$)/i.test(path),
  );
  const hasLibrarySource =
    hasPrefix("lib/") &&
    [...paths].some(
      (path) => path.startsWith("lib/") && path.endsWith(".dart"),
    );
  const hasExample = hasPrefix("example/");
  const hasProjectUrl = ["repository", "homepage", "issue_tracker"].some(
    (key) => isHttpUrl(input.pubspec[key]),
  );
  const conventionDetails = compact([
    !hasDescription &&
      "Description is missing or shorter than 20 characters (−8 points).",
    !hasLicense && "No LICENSE file was found at the package root (−8 points).",
    !hasLibrarySource &&
      "No Dart source file was found under lib/ (−8 points).",
    !hasExample && "No example/ directory was found (−3 points).",
    !hasProjectUrl &&
      "pubspec.yaml does not declare a valid repository, homepage, or issue_tracker URL (−3 points).",
  ]);

  const conventions = clamp(
    (hasDescription ? 8 : 0) +
      (hasLicense ? 8 : 0) +
      (hasLibrarySource ? 8 : 0) +
      (hasExample ? 3 : 0) +
      (hasProjectUrl ? 3 : 0),
    SCORE_WEIGHTS.conventions,
  );

  const readmePoints = meaningful(input.readme, 400)
    ? 15
    : meaningful(input.readme, 80)
      ? 9
      : 0;
  const hasChangelog =
    meaningful(input.changelog, 80) &&
    !input.changelog.includes("No changelog was included");
  const hasApiDocs = hasPrefix("doc/") || hasPath("dartdoc_options.yaml");
  const documentationDetails = compact([
    readmePoints === 0 &&
      "README is missing or shorter than 80 characters (−15 points).",
    readmePoints === 9 && "README is shorter than 400 characters (−6 points).",
    !hasChangelog &&
      "CHANGELOG is missing or does not contain meaningful release notes (−6 points).",
    !hasExample &&
      "No documented example was found under example/ (−5 points).",
    !hasApiDocs &&
      "No doc/ directory or dartdoc_options.yaml file was found (−4 points).",
  ]);
  const documentation = clamp(
    readmePoints +
      (hasChangelog ? 6 : 0) +
      (hasExample ? 5 : 0) +
      (hasApiDocs ? 4 : 0),
    SCORE_WEIGHTS.documentation,
  );

  const declaredPlatforms = Object.keys(record(input.pubspec.platforms));
  const pluginPlatforms = Object.keys(
    record(record(record(input.pubspec.flutter).plugin).platforms),
  );
  const platforms = isFlutter
    ? clamp(
        (declaredPlatforms.length
          ? declaredPlatforms.length
          : pluginPlatforms.length
            ? pluginPlatforms.length
            : 6) * 5,
        SCORE_WEIGHTS.platforms,
      )
    : SCORE_WEIGHTS.platforms;
  const platformCount = declaredPlatforms.length || pluginPlatforms.length;
  const platformDetails =
    isFlutter && platformCount > 0 && platformCount < 6
      ? [
          `Only ${platformCount} platform${platformCount === 1 ? " is" : "s are"} declared; each supported platform earns 5 points, up to 30.`,
        ]
      : [];

  const hasAnalysisOptions = hasPath("analysis_options.yaml");
  const hasTests =
    hasPrefix("test/") &&
    [...paths].some(
      (path) => path.startsWith("test/") && path.endsWith(".dart"),
    );

  const analyzerFindings = input.findings || [];
  const analyzerDetails = analyzerFindings.map((f) => {
    const penalty = f.severity === "ERROR" ? 12 : 3;
    const location = f.file ? ` in ${f.file}:${f.line}` : "";
    return `Analyzer ${f.severity.toLowerCase()}${location}: ${f.message} (${f.code ? `[${f.code}] ` : ""}−${penalty} points).`;
  });
  const analyzerDeductions = analyzerFindings.reduce((sum, f) => {
    return sum + (f.severity === "ERROR" ? 12 : 3);
  }, 0);

  const analysisDetails = compact([
    !hasPrefix("lib/") &&
      "No lib/ directory was found for static analysis (−20 points).",
    !hasAnalysisOptions && "analysis_options.yaml is missing (−10 points).",
    !hasTests && "No Dart tests were found under test/ (−10 points).",
    ...analyzerDetails,
  ]);
  const analysis = clamp(
    (hasPrefix("lib/") ? 20 : 0) +
      (hasAnalysisOptions ? 10 : 0) +
      (hasTests ? 10 : 0) -
      analyzerDeductions,
    SCORE_WEIGHTS.analysis,
  );

  const dependencyDetails = input.dependencies.flatMap((dependency) => {
    if (dependency.source === "path")
      return [`${dependency.name} uses a local path dependency (−10 points).`];
    if (dependency.source === "git")
      return [`${dependency.name} uses a Git dependency (−5 points).`];
    if (dependency.constraint === "any")
      return [`${dependency.name} has an unconstrained version (−3 points).`];
    return [];
  });
  const riskyDependencies = input.dependencies.reduce((penalty, dependency) => {
    if (dependency.source === "path") return penalty + 10;
    if (dependency.source === "git") return penalty + 5;
    if (dependency.constraint === "any") return penalty + 3;
    return penalty;
  }, 0);
  const dependencies = clamp(
    SCORE_WEIGHTS.dependencies - riskyDependencies,
    SCORE_WEIGHTS.dependencies,
  );

  const breakdown: Score["breakdown"] = [
    breakdownItem(
      "Package conventions",
      conventions,
      SCORE_WEIGHTS.conventions,
      conventionDetails,
    ),
    breakdownItem(
      "Documentation",
      documentation,
      SCORE_WEIGHTS.documentation,
      documentationDetails,
    ),
    breakdownItem(
      "Platform support",
      platforms,
      SCORE_WEIGHTS.platforms,
      platformDetails,
    ),
    breakdownItem(
      "Static analysis readiness",
      analysis,
      SCORE_WEIGHTS.analysis,
      analysisDetails,
    ),
    breakdownItem(
      "Dependency health",
      dependencies,
      SCORE_WEIGHTS.dependencies,
      dependencyDetails,
    ),
  ];
  const maxPoints = Object.values(SCORE_WEIGHTS).reduce(
    (sum, value) => sum + value,
    0,
  );
  const grantedPoints = breakdown.reduce((sum, item) => sum + item.points, 0);
  const popularityScore = round(
    Math.min(1, Math.log10(Math.max(0, input.downloads30d ?? 0) + 1) / 5),
  );
  const maintenanceScore = round(
    (documentation / 30) * 0.35 +
      (analysis / 40) * 0.35 +
      (dependencies / 30) * 0.3,
  );
  const platformTags = (
    declaredPlatforms.length ? declaredPlatforms : pluginPlatforms
  ).map((platform) => `platform:${platform}`);

  return {
    grantedPoints,
    maxPoints,
    qualityScore: round(grantedPoints / maxPoints),
    popularityScore,
    maintenanceScore,
    tags: [
      ...new Set([isFlutter ? "sdk:flutter" : "sdk:dart", ...platformTags]),
    ],
    breakdown,
  };
}

function breakdownItem(
  label: string,
  points: number,
  max: number,
  details: string[],
): Score["breakdown"][number] {
  const ratio = max === 0 ? 0 : points / max;
  return {
    label,
    points,
    max,
    status: ratio >= 0.8 ? "pass" : ratio >= 0.5 ? "warn" : "fail",
    details,
  };
}

function compact(values: Array<string | false>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function meaningful(value: string, minimumLength: number) {
  return value.trim().length >= minimumLength;
}

function isHttpUrl(value: unknown) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function normalizePath(path: string) {
  return path.replace(/^\.\//, "").replaceAll("\\", "/").toLowerCase();
}

function clamp(value: number, maximum: number) {
  return Math.max(0, Math.min(maximum, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
