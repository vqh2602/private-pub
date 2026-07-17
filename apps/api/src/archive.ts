import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tar from "tar-stream";
import { parse as parseYaml } from "yaml";
import semver from "semver";
import type { PackageFile } from "@private-pub/contracts";

export interface ArchiveEntry { path: string; size: number; type: "file" | "directory" | "symlink"; linkPath?: string }

export function validateArchiveIndex(entries: ArchiveEntry[], limits: { maxUncompressedBytes: number; maxFileCount: number; maxFileBytes?: number } = { maxUncompressedBytes: 256 * 1024 * 1024, maxFileCount: 64 * 1024 }) {
  const errors: string[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = entry.path.replaceAll("\\", "/");
    total += entry.size;
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) errors.push(`Unsafe path: ${entry.path}`);
    if (seen.has(normalized)) errors.push(`Duplicate path: ${entry.path}`);
    if (limits.maxFileBytes !== undefined && entry.size > limits.maxFileBytes) errors.push(`File exceeds limit: ${entry.path}`);
    if (entry.type === "symlink" && (!entry.linkPath || entry.linkPath.startsWith("/") || entry.linkPath.split("/").includes(".."))) errors.push(`Unsafe symlink: ${entry.path}`);
    seen.add(normalized);
  }
  if (total > limits.maxUncompressedBytes) errors.push("Archive exceeds uncompressed size limit");
  if (entries.length > limits.maxFileCount) errors.push("Archive exceeds file count limit");
  return { valid: errors.length === 0, errors, totalBytes: total };
}

export function archiveSha256(buffer: Buffer) { return createHash("sha256").update(buffer).digest("hex"); }

export interface ParsedDependency {
  name: string;
  constraint: string;
  scope: "dependencies" | "dev_dependencies" | "dependency_overrides";
  source: "hosted" | "sdk" | "git" | "path";
}

export interface ParsedPackageArchive {
  name: string;
  version: string;
  pubspec: Record<string, unknown>;
  description: string;
  dartConstraint: string;
  dartMinimum: string;
  flutterConstraint: string | null;
  flutterMinimum: string | null;
  readme: string;
  changelog: string;
  sha256: string;
  files: PackageFile[];
  dependencies: ParsedDependency[];
}

export async function parsePackageArchive(buffer: Buffer): Promise<ParsedPackageArchive> {
  const maxArchiveBytes = Number(process.env.MAX_ARCHIVE_BYTES ?? 100 * 1024 * 1024);
  if (buffer.length === 0) throw new Error("Package archive is empty.");
  if (buffer.length > maxArchiveBytes) throw new Error(`Package archive exceeds compressed size limit (${maxArchiveBytes} bytes).`);
  const extract = tar.extract();
  const entries: ArchiveEntry[] = [];
  const contents = new Map<string, Buffer>();
  extract.on("entry", (header, stream, next) => {
    const path = header.name.replace(/^\.\//, "").replaceAll("\\", "/");
    const type: ArchiveEntry["type"] = header.type === "directory" ? "directory" : header.type === "symlink" ? "symlink" : "file";
    entries.push({ path, size: header.size ?? 0, type, linkPath: header.linkname ?? undefined });
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => { if (type === "file") contents.set(path, Buffer.concat(chunks)); next(); });
    stream.resume();
  });
  await pipeline(Readable.from(buffer), createGunzip(), extract);
  const validation = validateArchiveIndex(entries, {
    maxUncompressedBytes: Number(process.env.MAX_UNCOMPRESSED_BYTES ?? 256 * 1024 * 1024),
    maxFileCount: Number(process.env.MAX_ARCHIVE_FILES ?? 64 * 1024)
  });
  if (!validation.valid) throw new Error(validation.errors.join("; "));

  const pubspecBuffer = contents.get("pubspec.yaml");
  if (!pubspecBuffer) throw new Error("Archive does not contain pubspec.yaml at its root.");
  const pubspec = parseYaml(pubspecBuffer.toString("utf8")) as Record<string, unknown>;
  const name = String(pubspec.name ?? "");
  const version = String(pubspec.version ?? "");
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("pubspec.yaml contains an invalid package name.");
  if (!semver.valid(version)) throw new Error("pubspec.yaml contains an invalid semantic version.");
  const environment = objectValue(pubspec.environment);
  const dartConstraint = String(environment.sdk ?? "");
  if (!dartConstraint) throw new Error("pubspec.yaml must declare environment.sdk.");
  const flutterConstraint = environment.flutter ? String(environment.flutter) : null;

  const dependencies = (["dependencies", "dev_dependencies", "dependency_overrides"] as const).flatMap((scope) =>
    Object.entries(objectValue(pubspec[scope])).map(([dependencyName, value]) => parseDependency(dependencyName, value, scope))
  );
  const files = entries.filter((entry) => entry.path).map<PackageFile>((entry) => {
    const content = contents.get(entry.path);
    const language = languageFor(entry.path);
    const isText = Boolean(content) && language !== "image" && content!.length <= 512_000;
    return {
      path: entry.type === "directory" && !entry.path.endsWith("/") ? `${entry.path}/` : entry.path,
      type: entry.type === "directory" ? "dir" : "file",
      size: entry.size,
      language,
      preview: entry.type === "directory" ? undefined : language === "markdown" ? "markdown" : language === "yaml" || language === "json" ? "structured" : language === "image" ? "image" : isText ? "code" : "unsupported",
      content: isText ? content!.toString("utf8") : undefined
    };
  });
  return {
    name,
    version,
    pubspec,
    description: String(pubspec.description ?? "No description provided."),
    dartConstraint,
    dartMinimum: minimumVersion(dartConstraint),
    flutterConstraint,
    flutterMinimum: flutterConstraint ? minimumVersion(flutterConstraint) : null,
    readme: contents.get("README.md")?.toString("utf8") ?? `# ${name}`,
    changelog: contents.get("CHANGELOG.md")?.toString("utf8") ?? "# Changelog\n\nNo changelog was included.",
    sha256: archiveSha256(buffer),
    files,
    dependencies
  };
}

function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function minimumVersion(constraint: string) { return constraint.match(/\d+\.\d+\.\d+/)?.[0] ?? constraint; }
function parseDependency(name: string, value: unknown, scope: ParsedDependency["scope"]): ParsedDependency {
  if (typeof value === "string") return { name, constraint: value, scope, source: "hosted" };
  const config = objectValue(value);
  if (config.sdk) return { name, constraint: String(config.sdk).toUpperCase(), scope, source: "sdk" };
  if (config.git) return { name, constraint: String(config.version ?? "git"), scope, source: "git" };
  if (config.path) return { name, constraint: String(config.path), scope, source: "path" };
  return { name, constraint: String(config.version ?? "any"), scope, source: "hosted" };
}
function languageFor(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".dart")) return "dart";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "image";
  return "text";
}
