import { describe, expect, it } from "vitest";
import { calculateScore, createPipeline, runPipeline } from "./pipeline.js";

describe("analysis pipeline", () => {
  it("runs every local mock step", async () => {
    const result = await runPipeline(
      {
        packageName: "fixture",
        version: "1.0.0",
        workDir: process.cwd(),
        isFlutter: true,
      },
      true,
    );
    expect(result.status).toBe("completed");
    expect(result.steps.map((item) => item.step)).toContain("pana");
    expect(result.score.grantedPoints).toBe(160);
  });
  it("deducts configurable quality points", () => {
    const score = calculateScore([
      {
        step: "analyze",
        status: "failed",
        durationMs: 1,
        findings: [
          {
            category: "analysis",
            severity: "error",
            title: "lint",
            message: "bad",
          },
        ],
      },
    ]);
    expect(score.grantedPoints).toBe(148);
  });
  it("refuses unsandboxed SDK analysis in production", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousSandbox = process.env.ANALYZER_SANDBOXED;
    process.env.NODE_ENV = "production";
    delete process.env.ANALYZER_SANDBOXED;
    try {
      expect(() => createPipeline(false)).toThrow(/sandbox/i);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousSandbox === undefined) delete process.env.ANALYZER_SANDBOXED;
      else process.env.ANALYZER_SANDBOXED = previousSandbox;
    }
  });
});
