import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createGunzip } from "node:zlib";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import tar from "tar-stream";
import { parse as parseYaml } from "yaml";
import semver from "semver";
import type { PackageFile } from "@private-pub/contracts";

export interface ArchiveEntry {
  path: string;
  size: number;
  type: "file" | "directory" | "symlink";
  linkPath?: string;
}

export class InvalidArchiveError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "InvalidArchiveError";
  }
}

export function validateArchiveIndex(
  entries: ArchiveEntry[],
  limits: {
    maxUncompressedBytes: number;
    maxFileCount: number;
    maxFileBytes?: number;
  } = { maxUncompressedBytes: 256 * 1024 * 1024, maxFileCount: 64 * 1024 },
) {
  const errors: string[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeArchivePath(entry.path);
    total += entry.size;
    if (!normalized) errors.push(`Unsafe path: ${entry.path}`);
    if (normalized && seen.has(normalized))
      errors.push(`Duplicate path: ${entry.path}`);
    if (limits.maxFileBytes !== undefined && entry.size > limits.maxFileBytes)
      errors.push(`File exceeds limit: ${entry.path}`);
    if (
      entry.type === "symlink" &&
      (!entry.linkPath || !normalizeArchivePath(entry.linkPath, true))
    )
      errors.push(`Unsafe symlink: ${entry.path}`);
    if (normalized) seen.add(normalized);
  }
  if (total > limits.maxUncompressedBytes)
    errors.push("Archive exceeds uncompressed size limit");
  if (entries.length > limits.maxFileCount)
    errors.push("Archive exceeds file count limit");
  return { valid: errors.length === 0, errors, totalBytes: total };
}

export function archiveSha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

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

export async function parsePackageArchive(
  source: Buffer | string,
): Promise<ParsedPackageArchive> {
  const maxArchiveBytes = positiveLimit("MAX_ARCHIVE_BYTES", 100 * 1024 * 1024);
  if (Buffer.isBuffer(source) && source.length === 0)
    throw new InvalidArchiveError("Package archive is empty.");
  if (Buffer.isBuffer(source) && source.length > maxArchiveBytes)
    throw new InvalidArchiveError(
      `Package archive exceeds compressed size limit (${maxArchiveBytes} bytes).`,
    );
  const maxUncompressedBytes = positiveLimit(
    "MAX_UNCOMPRESSED_BYTES",
    256 * 1024 * 1024,
  );
  const maxFileCount = positiveLimit("MAX_ARCHIVE_FILES", 64 * 1024);
  const maxTextPreviewBytes = positiveLimit("MAX_TEXT_PREVIEW_BYTES", 512_000);
  const extract = tar.extract();
  const entries: ArchiveEntry[] = [];
  const contents = new Map<string, Buffer>();
  const seen = new Set<string>();
  let totalBytes = 0;
  extract.on("entry", (header, stream, next) => {
    if (header.type === "directory" && [".", "./", "/"].includes(header.name)) {
      stream.on("end", next);
      stream.resume();
      return;
    }
    const path = normalizeArchivePath(header.name);
    const size = header.size ?? 0;
    const allowedType =
      header.type === "file" ||
      header.type === "directory" ||
      header.type === "symlink";
    const type: ArchiveEntry["type"] =
      header.type === "directory"
        ? "directory"
        : header.type === "symlink"
          ? "symlink"
          : "file";
    const linkPath = header.linkname ?? undefined;
    const invalid =
      !allowedType ||
      !path ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      seen.has(path) ||
      (type === "symlink" &&
        (!linkPath || !normalizeArchivePath(linkPath, true)));
    totalBytes += size;
    if (
      invalid ||
      entries.length + 1 > maxFileCount ||
      totalBytes > maxUncompressedBytes
    ) {
      stream.resume();
      const reason = !allowedType
        ? `Unsupported archive entry type: ${header.type}`
        : !path
          ? `Unsafe path: ${header.name}`
          : seen.has(path)
            ? `Duplicate path: ${header.name}`
            : type === "symlink" &&
                (!linkPath || !normalizeArchivePath(linkPath, true))
              ? `Unsafe symlink: ${header.name}`
              : entries.length + 1 > maxFileCount
                ? "Archive exceeds file count limit"
                : "Archive exceeds uncompressed size limit";
      extract.destroy(new InvalidArchiveError(reason));
      return;
    }
    seen.add(path);
    entries.push({ path, size, type, linkPath });
    const essential = ["pubspec.yaml", "README.md", "CHANGELOG.md"].includes(
      path,
    );
    if (path === "pubspec.yaml" && size > 1024 * 1024) {
      stream.resume();
      extract.destroy(
        new InvalidArchiveError("pubspec.yaml exceeds the 1 MB safety limit."),
      );
      return;
    }
    // Only package metadata is retained while indexing. Source files stay in the
    // tar.gz and are extracted individually when a caller requests a preview.
    const capture = type === "file" && size <= 1024 * 1024 && essential;
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => {
      if (capture) chunks.push(chunk);
    });
    stream.on("end", () => {
      if (capture) contents.set(path, Buffer.concat(chunks));
      next();
    });
    stream.resume();
  });
  const compressedHash = createHash("sha256");
  let compressedBytes = 0;
  const compressedLimiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      compressedBytes += chunk.length;
      if (compressedBytes > maxArchiveBytes) {
        callback(
          new InvalidArchiveError(
            `Package archive exceeds compressed size limit (${maxArchiveBytes} bytes).`,
          ),
        );
        return;
      }
      compressedHash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Buffer.isBuffer(source)
        ? Readable.from(source)
        : createReadStream(source),
      compressedLimiter,
      createGunzip(),
      extract,
    );
  } catch (error) {
    if (error instanceof InvalidArchiveError) throw error;
    if (!Buffer.isBuffer(source) && isFileSystemError(error)) throw error;
    throw new InvalidArchiveError("The package archive is not a valid tar.gz.");
  }
  if (compressedBytes === 0)
    throw new InvalidArchiveError("Package archive is empty.");
  const validation = validateArchiveIndex(entries, {
    maxUncompressedBytes,
    maxFileCount,
  });
  if (!validation.valid)
    throw new InvalidArchiveError(validation.errors.join("; "));

  const pubspecBuffer = contents.get("pubspec.yaml");
  if (!pubspecBuffer)
    throw new InvalidArchiveError(
      "Archive does not contain pubspec.yaml at its root.",
    );
  let pubspecValue: unknown;
  try {
    pubspecValue = parseYaml(pubspecBuffer.toString("utf8"));
  } catch {
    throw new InvalidArchiveError("pubspec.yaml is not valid YAML.");
  }
  if (
    !pubspecValue ||
    typeof pubspecValue !== "object" ||
    Array.isArray(pubspecValue)
  )
    throw new InvalidArchiveError("pubspec.yaml must contain a YAML mapping.");
  const pubspec = pubspecValue as Record<string, unknown>;
  const name = String(pubspec.name ?? "");
  const version = String(pubspec.version ?? "");
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw new InvalidArchiveError(
      "pubspec.yaml contains an invalid package name.",
    );
  if (!semver.valid(version))
    throw new InvalidArchiveError(
      "pubspec.yaml contains an invalid semantic version.",
    );
  const environment = objectValue(pubspec.environment);
  const dartConstraint = String(environment.sdk ?? "");
  if (!dartConstraint)
    throw new InvalidArchiveError("pubspec.yaml must declare environment.sdk.");
  const flutterConstraint = environment.flutter
    ? String(environment.flutter)
    : null;

  const dependencies = (
    ["dependencies", "dev_dependencies", "dependency_overrides"] as const
  ).flatMap((scope) =>
    Object.entries(objectValue(pubspec[scope])).map(([dependencyName, value]) =>
      parseDependency(dependencyName, value, scope),
    ),
  );
  const files = entries
    .filter((entry) => entry.path)
    .map<PackageFile>((entry) => {
      const language = languageFor(entry.path);
      const isText =
        entry.type === "file" &&
        language !== "image" &&
        entry.size <= maxTextPreviewBytes;
      return {
        path:
          entry.type === "directory" && !entry.path.endsWith("/")
            ? `${entry.path}/`
            : entry.path,
        type: entry.type === "directory" ? "dir" : "file",
        size: entry.size,
        language,
        preview:
          entry.type === "directory"
            ? undefined
            : language === "markdown"
              ? "markdown"
              : language === "yaml" || language === "json"
                ? "structured"
                : language === "image"
                  ? "image"
                  : isText
                    ? "code"
                    : "unsupported",
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
    flutterMinimum: flutterConstraint
      ? minimumVersion(flutterConstraint)
      : null,
    readme: contents.get("README.md")?.toString("utf8") ?? `# ${name}`,
    changelog:
      contents.get("CHANGELOG.md")?.toString("utf8") ??
      "# Changelog\n\nNo changelog was included.",
    sha256: compressedHash.digest("hex"),
    files,
    dependencies,
  };
}

/**
 * Reads one bounded text entry from an archive without loading the archive (or
 * unrelated entries) into memory. Returns undefined for a missing/non-file
 * entry or for an entry larger than the configured preview limit.
 */
export async function readArchiveTextFile(
  archivePath: string,
  requestedPath: string,
  maxBytes = positiveLimit("MAX_TEXT_PREVIEW_BYTES", 512_000),
): Promise<string | undefined> {
  const target = normalizeArchivePath(requestedPath);
  if (!target) return undefined;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error("Archive text preview limit must be a positive integer.");

  const extract = tar.extract();
  let content: Buffer | undefined;
  extract.on("entry", (header, stream, next) => {
    const path = normalizeArchivePath(header.name);
    const size = header.size ?? 0;
    const capture =
      header.type === "file" &&
      path === target &&
      Number.isSafeInteger(size) &&
      size >= 0 &&
      size <= maxBytes;
    const chunks: Buffer[] = [];
    let capturedBytes = 0;
    stream.on("data", (chunk: Buffer) => {
      if (!capture) return;
      capturedBytes += chunk.length;
      if (capturedBytes <= maxBytes) chunks.push(chunk);
    });
    stream.on("end", () => {
      if (capture && capturedBytes <= maxBytes)
        content = Buffer.concat(chunks, capturedBytes);
      next();
    });
    stream.resume();
  });

  try {
    await pipeline(createReadStream(archivePath), createGunzip(), extract);
  } catch (error) {
    if (isFileSystemError(error)) throw error;
    throw new InvalidArchiveError("The package archive is not a valid tar.gz.");
  }
  return content?.toString("utf8");
}

function positiveLimit(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}

function isFileSystemError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["ENOENT", "EACCES", "EPERM", "EISDIR"].includes(String(error.code))
  );
}

function normalizeArchivePath(value: string, allowRelativeTarget = false) {
  const replaced = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !replaced ||
    replaced.includes("\0") ||
    replaced.startsWith("/") ||
    /^[a-zA-Z]:\//.test(replaced)
  )
    return null;
  const parts = replaced.split("/");
  if (parts.includes("..")) return null;
  const normalized = parts.filter((part) => part && part !== ".").join("/");
  if (!normalized && !allowRelativeTarget) return null;
  return normalized || null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function minimumVersion(constraint: string) {
  return constraint.match(/\d+\.\d+\.\d+/)?.[0] ?? constraint;
}
function parseDependency(
  name: string,
  value: unknown,
  scope: ParsedDependency["scope"],
): ParsedDependency {
  if (typeof value === "string")
    return { name, constraint: value, scope, source: "hosted" };
  const config = objectValue(value);
  if (config.sdk)
    return {
      name,
      constraint: String(config.sdk).toUpperCase(),
      scope,
      source: "sdk",
    };
  if (config.git)
    return {
      name,
      constraint: String(config.version ?? "git"),
      scope,
      source: "git",
    };
  if (config.path)
    return { name, constraint: String(config.path), scope, source: "path" };
  return {
    name,
    constraint: String(config.version ?? "any"),
    scope,
    source: "hosted",
  };
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

export async function extractTarGz(
  archive: Buffer | string,
  targetDir: string,
): Promise<void> {
  const extract = tar.extract();
  await new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const sanitizedPath = header.name
        .replaceAll("\\", "/")
        .replace(/^\.\//, "");
      if (sanitizedPath.includes("..") || sanitizedPath.startsWith("/")) {
        stream.resume();
        return next();
      }
      const filePath = join(targetDir, sanitizedPath);
      if (header.type === "directory") {
        mkdir(filePath, { recursive: true })
          .then(() => {
            stream.resume();
            next();
          })
          .catch(next);
      } else if (header.type === "file") {
        mkdir(dirname(filePath), { recursive: true })
          .then(() => {
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
              writeFile(filePath, Buffer.concat(chunks))
                .then(() => next())
                .catch(next);
            });
            stream.resume();
          })
          .catch(next);
      } else {
        stream.resume();
        next();
      }
    });

    const inputStream = Buffer.isBuffer(archive)
      ? Readable.from(archive)
      : createReadStream(archive);

    pipeline(inputStream, createGunzip(), extract)
      .then(() => resolve())
      .catch(reject);
  });
}
