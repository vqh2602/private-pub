import { describe, expect, it } from "vitest";
import {
  calculateScore,
  createPipeline,
  fvmCommand,
  runPipeline,
} from "./pipeline.js";

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
  it("runs every SDK command through FVM when FVM is configured", () => {
    const previous = process.env.FVM_EXECUTABLE;
    process.env.FVM_EXECUTABLE = "/opt/fvm/bin/fvm";
    try {
      expect(fvmCommand("dart", ["analyze"])).toEqual({
        command: "/opt/fvm/bin/fvm",
        args: ["dart", "analyze"],
      });
      expect(fvmCommand("flutter", ["analyze"])).toEqual({
        command: "/opt/fvm/bin/fvm",
        args: ["flutter", "analyze"],
      });
    } finally {
      if (previous === undefined) delete process.env.FVM_EXECUTABLE;
      else process.env.FVM_EXECUTABLE = previous;
    }
  });

  it("runs SDK commands directly using system toolchain when FVM is not configured", () => {
    const previousFvmExec = process.env.FVM_EXECUTABLE;
    const previousUseFvm = process.env.USE_FVM;
    delete process.env.FVM_EXECUTABLE;
    delete process.env.USE_FVM;
    try {
      expect(fvmCommand("dart", ["analyze"])).toEqual({
        command: "dart",
        args: ["analyze"],
      });
      expect(fvmCommand("flutter", ["analyze"])).toEqual({
        command: "flutter",
        args: ["analyze"],
      });
    } finally {
      if (previousFvmExec === undefined) delete process.env.FVM_EXECUTABLE;
      else process.env.FVM_EXECUTABLE = previousFvmExec;
      if (previousUseFvm === undefined) delete process.env.USE_FVM;
      else process.env.USE_FVM = previousUseFvm;
    }
  });
});
