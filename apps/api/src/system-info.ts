import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SystemInfo {
  appVersion: string;
  sdkProvider: "fvm" | "system";
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

export function clearSystemInfoCache(): void {
  cachedSystemInfo = undefined;
}

async function inspectSystemInfo(): Promise<SystemInfo> {
  const appVersion = process.env.APP_VERSION?.trim() || "0.1.1";
  const configured = configuredVersions();
  if (configured) {
    return {
      appVersion,
      sdkProvider: configured.fvmVersion ? "fvm" : "system",
      ...configured,
    };
  }

  const useFvm = process.env.USE_FVM === "true" || !!process.env.FVM_EXECUTABLE;
  if (useFvm) {
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
  } else {
    // System mode (no FVM)
    try {
      let flutterVersion: string | null = null;
      let dartVersion: string | null = null;
      try {
        const flutterResult = await execFileAsync(
          "flutter",
          ["--version", "--machine"],
          {
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          },
        );
        const sdk = JSON.parse(flutterResult.stdout) as {
          flutterVersion?: unknown;
          frameworkVersion?: unknown;
          dartSdkVersion?: unknown;
        };
        flutterVersion = stringValue(
          sdk.flutterVersion ?? sdk.frameworkVersion,
        );
        dartVersion = stringValue(sdk.dartSdkVersion);
      } catch {
        // Flutter is not available or failed
      }

      if (!dartVersion) {
        try {
          const dartResult = await execFileAsync("dart", ["--version"], {
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
          });
          const match = /version:\s*([^\s]+)/.exec(
            dartResult.stdout || dartResult.stderr,
          );
          if (match && match[1]) {
            dartVersion = match[1];
          }
        } catch {
          // Dart failed too
        }
      }

      return {
        appVersion,
        sdkProvider: "system",
        fvmVersion: null,
        flutterVersion,
        dartVersion,
        available: Boolean(dartVersion),
      };
    } catch {
      return {
        appVersion,
        sdkProvider: "system",
        fvmVersion: null,
        flutterVersion: null,
        dartVersion: null,
        available: false,
      };
    }
  }
}

function configuredVersions() {
  const fvmVersion = process.env.SYSTEM_FVM_VERSION?.trim() || null;
  const flutterVersion = process.env.SYSTEM_FLUTTER_VERSION?.trim() || null;
  const dartVersion = process.env.SYSTEM_DART_VERSION?.trim() || null;
  if (!flutterVersion && !dartVersion) return null;
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
