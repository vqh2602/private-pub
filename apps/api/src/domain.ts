import type {
  PackageDetail,
  PackageFile,
  PackageSummary,
  PackageVersion,
  RegistryStats,
  Score,
} from "@private-pub/contracts";

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
  subjectId: string;
  name: string;
  prefix: string;
  scopes: string[];
  tokenHash: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export type AccountRole = "super_admin" | "admin" | "user";

export interface AccountRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: AccountRole;
  mustChangePassword: boolean;
  isActive: boolean;
}

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface PublishArchiveResult {
  name: string;
  version: string;
  packageCreated: boolean;
}

export interface PublishActor {
  id: string;
  username?: string;
}

export interface PackageMetadata {
  name: string;
  isDiscontinued: boolean;
  latestVersion: PackageVersion;
  versions: PackageVersion[];
}

export interface PackageSearchFilters {
  sdk?: string[];
  platform?: string[];
  publisher?: string;
  hasPreview?: boolean;
  verifiedPublisher?: boolean;
  minScore?: number;
  sort?: string;
  page?: number;
  limit?: number;
}

export interface PackageSearchResult {
  items: PackageSummary[];
  total: number;
}

export interface PublishedPackage {
  package: PackageSummary;
  versions: PackageVersion[];
}

export interface PackageDetailOptions {
  includeVersions?: boolean;
  includeFiles?: boolean;
}

export interface RegistryRepository {
  readonly mode: "demo" | "database";
  initialize(): Promise<void>;
  close?(): Promise<void>;
  getStats(): Promise<RegistryStats>;
  search(
    query: string,
    filters: PackageSearchFilters,
  ): Promise<PackageSearchResult>;
  listPublishedPackages(identities: string[]): Promise<PublishedPackage[]>;
  getPackageMetadata(name: string): Promise<PackageMetadata | null>;
  getPackage(
    name: string,
    options?: PackageDetailOptions,
  ): Promise<PackageDetail | null>;
  getVersion(name: string, version: string): Promise<PackageVersion | null>;
  getFiles(name: string, version: string): Promise<PackageFile[] | null>;
  getFile(
    name: string,
    version: string,
    path: string,
  ): Promise<PackageFile | null>;
  getScore(name: string, version: string): Promise<Score | null>;
  setRetraction(
    name: string,
    version: string,
    retracted: boolean,
  ): Promise<PackageVersion | null>;
  setDiscontinued(
    name: string,
    discontinued: boolean,
  ): Promise<PackageSummary | null>;
  createImport(
    input: Omit<ImportJobRecord, "id" | "status" | "createdAt">,
  ): Promise<ImportJobRecord>;
  getImport(id: string): Promise<ImportJobRecord | null>;
  listImports(): Promise<ImportJobRecord[]>;
  findAccountByUsername(username: string): Promise<AccountRecord | null>;
  listAccounts(): Promise<AccountRecord[]>;
  createAccount(input: {
    username: string;
    passwordHash: string;
    role: AccountRole;
    mustChangePassword: boolean;
  }): Promise<AccountRecord | null>;
  createSession(
    accountId: string,
    tokenHash: string,
    expiresAt: string,
  ): Promise<void>;
  authenticateSession(tokenHash: string): Promise<AccountRecord | null>;
  revokeSession(tokenHash: string): Promise<void>;
  updatePassword(accountId: string, passwordHash: string): Promise<void>;
  listTokens(accountId: string): Promise<TokenSummary[]>;
  saveToken(token: TokenRecord): Promise<void>;
  authenticateToken(tokenHash: string): Promise<{
    id: string;
    username?: string;
    role?: AccountRole;
    scopes: string[];
  } | null>;
  revokeToken(id: string, accountId: string): Promise<boolean>;
  publishArchive(
    archive: Buffer,
    actor: PublishActor,
  ): Promise<PublishArchiveResult>;
  getArchive(name: string, version: string): Promise<Buffer | null>;
}
