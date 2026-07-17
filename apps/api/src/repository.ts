import type { PackageFile, PackageSummary } from "@private-pub/contracts";
import { createHash, randomUUID } from "node:crypto";
import { demoDetails } from "./demo-data.js";
import type { ImportJobRecord, RegistryRepository, TokenRecord } from "./domain.js";

export class DemoRegistryRepository implements RegistryRepository {
  private readonly imports = new Map<string, ImportJobRecord>();
  private readonly tokens = new Map<string, TokenRecord>();

  async search(query: string, filters: { sdk?: string; platform?: string; publisher?: string; hasPreview?: boolean; sort?: string }) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    let values = [...demoDetails.values()].map((entry) => entry.package).filter((item) => {
      const text = [item.name, item.description, item.publisherId, ...item.topics].join(" ").toLowerCase();
      return terms.every((term) => text.includes(term)) &&
        (!filters.publisher || item.publisherId === filters.publisher) &&
        (filters.hasPreview === undefined || item.hasPreview === filters.hasPreview) &&
        (!filters.platform || demoDetails.get(item.name)?.latestVersion.platforms.includes(filters.platform));
    });
    const sort = filters.sort ?? "relevance";
    values = values.sort((a, b) => sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : sort === "downloads" ? b.downloads30d - a.downloads30d : sort === "score" ? b.score - a.score : this.relevance(b, query) - this.relevance(a, query));
    return structuredClone(values);
  }

  private relevance(item: PackageSummary, query: string) {
    if (!query) return item.score + Math.log10(item.downloads30d + 1) * 10;
    const q = query.toLowerCase();
    return (item.name === q ? 1000 : item.name.includes(q) ? 500 : 0) + (item.description.toLowerCase().includes(q) ? 100 : 0) + item.score;
  }

  async getPackage(name: string) { return structuredClone(demoDetails.get(name) ?? null); }
  async getVersion(name: string, version: string) { return structuredClone(demoDetails.get(name)?.versions.find((item) => item.version === version) ?? null); }
  async getFiles(name: string, version: string) { return (await this.getVersion(name, version)) ? structuredClone(demoDetails.get(name)?.files ?? []) : null; }
  async getFile(name: string, version: string, path: string): Promise<PackageFile | null> { return (await this.getFiles(name, version))?.find((item) => item.path === path) ?? null; }
  async getScore(name: string, version: string) { return (await this.getVersion(name, version)) ? structuredClone(demoDetails.get(name)?.score ?? null) : null; }
  async setRetraction(name: string, version: string, retracted: boolean) {
    const item = demoDetails.get(name)?.versions.find((entry) => entry.version === version);
    if (!item) return null;
    item.retractedAt = retracted ? new Date().toISOString() : null;
    return structuredClone(item);
  }
  async setDiscontinued(name: string, discontinued: boolean) {
    const item = demoDetails.get(name)?.package;
    if (!item) return null;
    item.isDiscontinued = discontinued;
    return structuredClone(item);
  }
  async createImport(input: Omit<ImportJobRecord, "id" | "status" | "createdAt">) {
    const job: ImportJobRecord = { ...input, id: `imp_${randomUUID().replaceAll("-", "").slice(0, 24)}`, status: "queued", createdAt: new Date().toISOString() };
    this.imports.set(job.id, job);
    return structuredClone(job);
  }
  async getImport(id: string) { return structuredClone(this.imports.get(id) ?? null); }
  async listImports() { return structuredClone([...this.imports.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }
  async saveToken(token: TokenRecord) { this.tokens.set(token.id, token); }
  async revokeToken(id: string) { const token = this.tokens.get(id); if (!token) return false; token.revokedAt = new Date().toISOString(); return true; }
}

export function hashToken(token: string, pepper: string) {
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}
