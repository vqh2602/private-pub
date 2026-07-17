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
});
