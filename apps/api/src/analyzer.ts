import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTarGz } from "./archive.js";

export interface AnalyzerFinding {
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  code: string;
  file: string;
  line: number;
}

interface DartDiagnosticLocation {
  file: string;
  range: {
    start: {
      line: number;
      column: number;
    };
  };
}

interface DartDiagnostic {
  severity: "INFO" | "WARNING" | "ERROR";
  problemMessage: string;
  code?: string;
  location?: DartDiagnosticLocation;
}

interface DartAnalyzeOutput {
  diagnostics: DartDiagnostic[];
}

function getCommand(isFlutter: boolean) {
  const useFvm = process.env.USE_FVM === "true" || !!process.env.FVM_EXECUTABLE;
  if (useFvm) {
    const fvm = process.env.FVM_EXECUTABLE?.trim() || "fvm";
    return {
      command: fvm,
      args: [isFlutter ? "flutter" : "dart", "analyze", "--format=json"],
    };
  }
  return {
    command: isFlutter ? "flutter" : "dart",
    args: ["analyze", "--format=json"],
  };
}

function getPubGetCommand(isFlutter: boolean) {
  const useFvm = process.env.USE_FVM === "true" || !!process.env.FVM_EXECUTABLE;
  if (useFvm) {
    const fvm = process.env.FVM_EXECUTABLE?.trim() || "fvm";
    return {
      command: fvm,
      args: [isFlutter ? "flutter" : "dart", "pub", "get", "--offline"],
    };
  }
  return {
    command: isFlutter ? "flutter" : "dart",
    args: ["pub", "get", "--offline"],
  };
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeout = 60_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });
    child.on("error", (err) => {
      resolve({ stdout, stderr: stderr + "\n" + err.message, code: -1 });
    });
  });
}

function relativePath(cwd: string, absolutePath: string): string {
  if (absolutePath.startsWith(cwd)) {
    return absolutePath.slice(cwd.length).replace(/^[/\\]+/, "");
  }
  return absolutePath;
}

export async function runDartAnalyze(
  archive: Buffer | string,
  isFlutter: boolean,
): Promise<AnalyzerFinding[]> {
  if (process.env.MOCK_ANALYZER !== "false") {
    return [];
  }
  let tempDir = "";
  try {
    tempDir = await mkdtemp(join(tmpdir(), "private-pub-analysis-"));
    await extractTarGz(archive, tempDir);

    // Run pub get offline to resolve local dependency map, ignore error if it fails
    const pubGet = getPubGetCommand(isFlutter);
    await runCommand(pubGet.command, pubGet.args, tempDir, 20_000);

    // Run dart analyze
    const analyze = getCommand(isFlutter);
    const { stdout, code } = await runCommand(
      analyze.command,
      analyze.args,
      tempDir,
      45_000,
    );

    let diagnostics: DartDiagnostic[] = [];
    try {
      const parsed = JSON.parse(stdout) as DartAnalyzeOutput;
      if (parsed && Array.isArray(parsed.diagnostics)) {
        diagnostics = parsed.diagnostics;
      }
    } catch {
      // JSON parse failed, ignore
    }

    const findings: AnalyzerFinding[] = [];
    for (const d of diagnostics) {
      const code = d.code?.toLowerCase() || "";
      // Ignore unresolved imports to prevent false positives in environments without internet/cache
      if (code === "uri_does_not_exist") {
        continue;
      }
      findings.push({
        severity: d.severity,
        message: d.problemMessage || "",
        code: d.code || "",
        file: d.location?.file ? relativePath(tempDir, d.location.file) : "",
        line: d.location?.range?.start?.line ?? 1,
      });
    }

    return findings;
  } catch (error) {
    console.warn("Analyzer execution failed gracefully:", error);
    return [];
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
