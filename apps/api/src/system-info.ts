import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SystemInfo {
  appVersion: string;
  sdkProvider: "fvm";
  fvmVersion: string | null;
  flutterVersion: string | null;
  dartVersion: string | null;
  available: boolean;
}

let cachedSystemInfo: Promise<SystemInfo> | undefined;

export function getSystemInfo(): Promise<SystemInfo> {
  cachedSystemInfo ??= inspectSystemInfo();
  return cachedSystemInfo;
}

async function inspectSystemInfo(): Promise<SystemInfo> {
  const appVersion = process.env.APP_VERSION?.trim() || "0.1.0";
  const configured = configuredVersions();
  if (configured) return { appVersion, sdkProvider: "fvm", ...configured };

  const executable = process.env.FVM_EXECUTABLE?.trim() || "fvm";
  const cwd = process.env.FVM_PROJECT_DIR?.trim() || process.cwd();
  try {
    const [fvm, flutter] = await Promise.all([
      execFileAsync(executable, ["--version"], {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }),
      execFileAsync(executable, ["flutter", "--version", "--machine"], {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }),
    ]);
    const sdk = JSON.parse(flutter.stdout) as {
      flutterVersion?: unknown;
      frameworkVersion?: unknown;
      dartSdkVersion?: unknown;
    };
    const flutterVersion = stringValue(
      sdk.flutterVersion ?? sdk.frameworkVersion,
    );
    const dartVersion = stringValue(sdk.dartSdkVersion);
    return {
      appVersion,
      sdkProvider: "fvm",
      fvmVersion: fvm.stdout.trim() || fvm.stderr.trim() || null,
      flutterVersion,
      dartVersion,
      available: Boolean(flutterVersion && dartVersion),
    };
  } catch {
    return {
      appVersion,
      sdkProvider: "fvm",
      fvmVersion: null,
      flutterVersion: null,
      dartVersion: null,
      available: false,
    };
  }
}

function configuredVersions() {
  const fvmVersion = process.env.SYSTEM_FVM_VERSION?.trim();
  const flutterVersion = process.env.SYSTEM_FLUTTER_VERSION?.trim();
  const dartVersion = process.env.SYSTEM_DART_VERSION?.trim();
  if (!fvmVersion || !flutterVersion || !dartVersion) return null;
  return {
    fvmVersion,
    flutterVersion,
    dartVersion,
    available: true,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
