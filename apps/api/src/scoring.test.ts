import { describe, expect, it } from "vitest";
import { calculatePackageScore } from "./scoring.js";

describe("automatic package scoring", () => {
  it("calculates a complete score breakdown from package contents", () => {
    const score = calculatePackageScore({
      pubspec: {
        name: "healthy_package",
        description: "A well documented Flutter package used by the company.",
        repository: "https://example.test/healthy_package",
        environment: { sdk: ">=3.4.0 <4.0.0", flutter: ">=3.22.0" },
        dependencies: { flutter: { sdk: "flutter" } }
      },
      description: "A well documented Flutter package used by the company.",
      readme: "# Healthy package\n\n" + "Usage and examples. ".repeat(30),
      changelog: "# Changelog\n\n## 1.0.0\n\n" + "Initial stable release with documented migration notes. ".repeat(2),
      files: [
        { path: "LICENSE" }, { path: "lib/healthy_package.dart" }, { path: "analysis_options.yaml" },
        { path: "test/healthy_package_test.dart" }, { path: "example/main.dart" }, { path: "doc/api.md" }
      ],
      dependencies: [{ name: "flutter", constraint: "FLUTTER", scope: "dependencies", source: "sdk" }]
    });

    expect(score.grantedPoints).toBe(160);
    expect(score.qualityScore).toBe(1);
    expect(score.breakdown).toHaveLength(5);
    expect(score.breakdown.every((item) => item.status === "pass")).toBe(true);
  });

  it("deducts points for missing quality signals and risky dependencies", () => {
    const score = calculatePackageScore({
      pubspec: { name: "minimal", environment: { sdk: ">=3.4.0 <4.0.0" } },
      description: "Short",
      readme: "# Minimal",
      changelog: "",
      files: [{ path: "lib/minimal.dart" }],
      dependencies: [{ name: "local_dep", constraint: "../local_dep", scope: "dependencies", source: "path" }]
    });

    expect(score.grantedPoints).toBeLessThan(100);
    expect(score.breakdown.find((item) => item.label === "Dependency health")?.points).toBe(20);
    expect(score.breakdown.find((item) => item.label === "Dependency health")?.details).toContain("local_dep uses a local path dependency (−10 points).");
    expect(score.breakdown.find((item) => item.label === "Documentation")?.details).toContain("README is missing or shorter than 80 characters (−15 points).");
  });

  it("deducts points based on analyzer findings (errors and warnings)", () => {
    const score = calculatePackageScore({
      pubspec: {
        name: "healthy_package",
        description: "A well documented Flutter package used by the company.",
        repository: "https://example.test/healthy_package",
        environment: { sdk: ">=3.4.0 <4.0.0" }
      },
      description: "A well documented Flutter package used by the company.",
      readme: "# Healthy package\n\n" + "Usage and examples. ".repeat(30),
      changelog: "# Changelog\n\n## 1.0.0\n\n" + "Initial stable release. ".repeat(2),
      files: [
        { path: "LICENSE" }, { path: "lib/healthy_package.dart" }, { path: "analysis_options.yaml" },
        { path: "test/healthy_package_test.dart" }, { path: "example/main.dart" }
      ],
      dependencies: [],
      findings: [
        { severity: "ERROR", message: "Missing return", code: "missing_return", file: "lib/healthy_package.dart", line: 10 },
        { severity: "WARNING", message: "Avoid print", code: "avoid_print", file: "lib/healthy_package.dart", line: 25 }
      ]
    });

    // Max static analysis is 40.
    // We expect: 20 (lib) + 10 (analysis_options) + 10 (test) = 40.
    // Deductions: 1 ERROR (-12) + 1 WARNING (-3) = -15 points.
    // Static analysis score should be: 40 - 15 = 25 points.
    const analysisBreakdown = score.breakdown.find((item) => item.label === "Static analysis readiness");
    expect(analysisBreakdown?.points).toBe(25);
    expect(analysisBreakdown?.details).toContain("Analyzer error in lib/healthy_package.dart:10: Missing return ([missing_return] −12 points).");
    expect(analysisBreakdown?.details).toContain("Analyzer warning in lib/healthy_package.dart:25: Avoid print ([avoid_print] −3 points).");
  });
});
