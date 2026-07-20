import { spawn } from "node:child_process";

export interface AnalysisContext {
  packageName: string;
  version: string;
  workDir: string;
  isFlutter: boolean;
}

export interface Finding {
  category: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
}
export interface StepResult {
  step: string;
  status: "passed" | "warning" | "failed" | "skipped";
  durationMs: number;
  findings: Finding[];
}
export interface PipelineResult {
  status: "completed" | "failed";
  mode: "mock" | "sdk";
  steps: StepResult[];
  score: ReturnType<typeof calculateScore>;
}

export interface AnalysisStep {
  name: string;
  run(context: AnalysisContext): Promise<StepResult>;
}

export interface FvmCommand {
  command: string;
  args: string[];
}

export function fvmCommand(
  sdk: "dart" | "flutter",
  args: string[],
): FvmCommand {
  return {
    command: process.env.FVM_EXECUTABLE?.trim() || "fvm",
    args: [sdk, ...args],
  };
}

export class HookStep implements AnalysisStep {
  constructor(
    public name: string,
    private readonly action: (
      context: AnalysisContext,
    ) => Promise<Finding[]> = async () => [],
  ) {}
  async run(context: AnalysisContext): Promise<StepResult> {
    const started = Date.now();
    const findings = await this.action(context);
    return {
      step: this.name,
      status: findings.some((item) => item.severity === "error")
        ? "failed"
        : findings.length
          ? "warning"
          : "passed",
      durationMs: Date.now() - started,
      findings,
    };
  }
}

export class CommandStep implements AnalysisStep {
  constructor(
    public name: string,
    private readonly command: string,
    private readonly args: string[],
    private readonly enabled = true,
  ) {}
  async run(context: AnalysisContext): Promise<StepResult> {
    const started = Date.now();
    if (!this.enabled)
      return {
        step: this.name,
        status: "skipped",
        durationMs: 0,
        findings: [],
      };
    return new Promise((resolve) => {
      const child = spawn(this.command, this.args, {
        cwd: context.workDir,
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 180_000,
        shell: false,
        env: analyzerEnvironment(),
      });
      let stderr = "";
      let settled = false;
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 4000)
          stderr += String(chunk).slice(0, 4000 - stderr.length);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({
          step: this.name,
          status: "failed",
          durationMs: Date.now() - started,
          findings: [
            {
              category: "tooling",
              severity: "error",
              title: `${this.command} could not start`,
              message: error.message,
            },
          ],
        });
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        const message = signal
          ? `${this.name} was terminated by ${signal}. ${stderr}`.trim()
          : stderr;
        resolve({
          step: this.name,
          status: code === 0 ? "passed" : "failed",
          durationMs: Date.now() - started,
          findings:
            code === 0
              ? []
              : [
                  {
                    category: "analysis",
                    severity: "error",
                    title: `${this.name} failed`,
                    message,
                  },
                ],
        });
      });
    });
  }
}

export function createPipeline(
  mock = process.env.MOCK_ANALYZER !== "false",
): AnalysisStep[] {
  if (mock)
    return [
      new HookStep("load-archive"),
      new HookStep("validate-unpack"),
      new HookStep("malware-scan"),
      new HookStep("pana"),
      new HookStep("dart-analyze"),
      new HookStep("flutter-analyze"),
      new HookStep("dartdoc"),
      new HookStep("persist-findings"),
      new HookStep("index-search"),
    ];
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ANALYZER_SANDBOXED !== "true"
  )
    throw new Error(
      "SDK analysis is disabled until ANALYZER_SANDBOXED=true is set by an isolated runner.",
    );
  const pana = fvmCommand("dart", [
    "pub",
    "global",
    "run",
    "pana",
    "--no-warning",
  ]);
  const dartAnalyze = fvmCommand("dart", ["analyze", "--format=json"]);
  const flutterAnalyze = fvmCommand("flutter", ["analyze"]);
  const dartdoc = fvmCommand("dart", ["doc"]);
  return [
    new HookStep("load-archive"),
    new HookStep("validate-unpack"),
    new HookStep("malware-scan"), // Replace with ClamAV/container-scanner adapter in production.
    new CommandStep("pana", pana.command, pana.args),
    new CommandStep("dart-analyze", dartAnalyze.command, dartAnalyze.args),
    new CommandStep(
      "flutter-analyze",
      flutterAnalyze.command,
      flutterAnalyze.args,
      true,
    ),
    new CommandStep("dartdoc", dartdoc.command, dartdoc.args),
    new HookStep("persist-findings"),
    new HookStep("index-search"),
  ];
}

function analyzerEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "PUB_CACHE",
    "FLUTTER_ROOT",
    "DART_SDK",
    "FVM_CACHE_PATH",
    "FVM_HOME",
    "LANG",
    "LC_ALL",
  ];
  return Object.fromEntries(
    allowed.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
}

export function calculateScore(results: StepResult[]) {
  const weights = {
    conventions: 30,
    docs: 30,
    platforms: 30,
    analysis: 40,
    dependencies: 30,
  };
  const failures = results
    .flatMap((step) => step.findings)
    .filter((item) => item.severity === "error").length;
  const warnings = results
    .flatMap((step) => step.findings)
    .filter((item) => item.severity === "warning").length;
  const maxPoints = Object.values(weights).reduce(
    (sum, value) => sum + value,
    0,
  );
  const grantedPoints = Math.max(0, maxPoints - failures * 12 - warnings * 3);
  return {
    grantedPoints,
    maxPoints,
    qualityScore: grantedPoints / maxPoints,
    popularityScore: 0,
    maintenanceScore: failures ? 0.65 : 0.9,
    weights,
  };
}

export async function runPipeline(
  context: AnalysisContext,
  mock?: boolean,
): Promise<PipelineResult> {
  const resolvedMock = mock ?? process.env.MOCK_ANALYZER !== "false";
  const steps: StepResult[] = [];
  for (const step of createPipeline(resolvedMock))
    steps.push(await step.run(context));
  return {
    status: steps.some((step) => step.status === "failed")
      ? "failed"
      : "completed",
    mode: resolvedMock ? "mock" : "sdk",
    steps,
    score: calculateScore(steps),
  };
}
