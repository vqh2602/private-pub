import type { PackageDetail, PackageFile, PackageSummary, PackageVersion, Score } from "@private-pub/contracts";

export interface ImportJobRecord {
  id: string;
  packageName: string;
  versions: string[];
  mode: string;
  status: "queued" | "running" | "failed" | "completed" | "partial";
  createdAt: string;
  summary?: Record<string, unknown>;
}

export interface TokenRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface RegistryRepository {
  search(query: string, filters: { sdk?: string; platform?: string; publisher?: string; hasPreview?: boolean; sort?: string }): Promise<PackageSummary[]>;
  getPackage(name: string): Promise<PackageDetail | null>;
  getVersion(name: string, version: string): Promise<PackageVersion | null>;
  getFiles(name: string, version: string): Promise<PackageFile[] | null>;
  getFile(name: string, version: string, path: string): Promise<PackageFile | null>;
  getScore(name: string, version: string): Promise<Score | null>;
  setRetraction(name: string, version: string, retracted: boolean): Promise<PackageVersion | null>;
  setDiscontinued(name: string, discontinued: boolean): Promise<PackageSummary | null>;
  createImport(input: Omit<ImportJobRecord, "id" | "status" | "createdAt">): Promise<ImportJobRecord>;
  getImport(id: string): Promise<ImportJobRecord | null>;
  listImports(): Promise<ImportJobRecord[]>;
  saveToken(token: TokenRecord): Promise<void>;
  revokeToken(id: string): Promise<boolean>;
}
