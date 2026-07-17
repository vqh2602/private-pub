import { createHash } from "node:crypto";

export interface ArchiveEntry { path: string; size: number; type: "file" | "directory" | "symlink"; linkPath?: string }

export function validateArchiveIndex(entries: ArchiveEntry[], limits = { maxArchiveBytes: 50 * 1024 * 1024, maxFileBytes: 10 * 1024 * 1024 }) {
  const errors: string[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = entry.path.replaceAll("\\", "/");
    total += entry.size;
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) errors.push(`Unsafe path: ${entry.path}`);
    if (seen.has(normalized)) errors.push(`Duplicate path: ${entry.path}`);
    if (entry.size > limits.maxFileBytes) errors.push(`File exceeds limit: ${entry.path}`);
    if (entry.type === "symlink" && (!entry.linkPath || entry.linkPath.startsWith("/") || entry.linkPath.split("/").includes(".."))) errors.push(`Unsafe symlink: ${entry.path}`);
    seen.add(normalized);
  }
  if (total > limits.maxArchiveBytes) errors.push("Archive exceeds uncompressed size limit");
  return { valid: errors.length === 0, errors, totalBytes: total };
}

export function archiveSha256(buffer: Buffer) { return createHash("sha256").update(buffer).digest("hex"); }
