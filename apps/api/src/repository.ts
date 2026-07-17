import type { PackageFile, PackageSummary } from "@private-pub/contracts";
import { createHash, randomUUID } from "node:crypto";
import { demoDetails } from "./demo-data.js";
import type {
  AccountRecord,
  ImportJobRecord,
  PublishActor,
  RegistryRepository,
  TokenRecord,
} from "./domain.js";
import { parsePackageArchive } from "./archive.js";
import semver from "semver";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { scoreParsedPackage } from "./scoring.js";
import { releaseChannel, selectLatestRelease } from "./release-channel.js";

export class DemoRegistryRepository implements RegistryRepository {
  readonly mode = "demo" as const;
  private readonly details = structuredClone(demoDetails);
  private readonly imports = new Map<string, ImportJobRecord>();
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly archives = new Map<string, Buffer>();
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly sessions = new Map<
    string,
    { accountId: string; expiresAt: string }
  >();

  constructor(private readonly storageDirectory?: string) {}

  async initialize() {
    if (!this.storageDirectory) return;
    const directory = resolve(this.storageDirectory);
    await mkdir(directory, { recursive: true });
    const filenames = (await readdir(directory))
      .filter((filename) => filename.endsWith(".tar.gz"))
      .sort();
    for (const filename of filenames) {
      const archive = await readFile(join(directory, filename));
      const parsed = await parsePackageArchive(archive);
      this.registerParsedArchive(parsed, archive, {
        id: "restored-archive",
        username: "Unknown",
      });
    }
  }

  async close() {}

  async getStats() {
    const details = [...this.details.values()];
    const versions = details.reduce(
      (total, detail) => total + detail.versions.length,
      0,
    );
    const analyzedVersions = details.reduce(
      (total, detail) =>
        total +
        (detail.score.breakdown.length > 0 ? detail.versions.length : 0),
      0,
    );
    return { packages: details.length, versions, analyzedVersions };
  }

  async search(
    query: string,
    filters: {
      sdk?: string[];
      platform?: string[];
      publisher?: string;
      hasPreview?: boolean;
      verifiedPublisher?: boolean;
      minScore?: number;
      sort?: string;
    },
  ) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    let values = [...this.details.values()]
      .map((entry) => entry.package)
      .filter((item) => {
        const text = [
          item.name,
          item.description,
          item.publisherId,
          ...item.topics,
        ]
          .join(" ")
          .toLowerCase();
        return (
          terms.every((term) => text.includes(term)) &&
          (!filters.publisher || item.publisherId === filters.publisher) &&
          (filters.hasPreview === undefined ||
            item.hasPreview === filters.hasPreview) &&
          (filters.verifiedPublisher === undefined ||
            (item.publisherId !== "local.private") ===
              filters.verifiedPublisher) &&
          (filters.minScore === undefined || item.score >= filters.minScore) &&
          (!filters.sdk?.length ||
            filters.sdk.includes(
              this.details.get(item.name)?.requirements.flutterConstraint
                ? "flutter"
                : "dart",
            )) &&
          (!filters.platform?.length ||
            filters.platform.some((platform) => {
              const platforms = this.details.get(item.name)?.latestVersion
                .platforms;
              return platform === "desktop"
                ? platforms?.some((value) =>
                    ["linux", "macos", "windows"].includes(value),
                  )
                : platforms?.includes(platform);
            }))
        );
      });
    const sort = filters.sort ?? "relevance";
    values = values.sort((a, b) =>
      sort === "updated"
        ? b.updatedAt.localeCompare(a.updatedAt)
        : sort === "downloads"
          ? b.downloads30d - a.downloads30d
          : sort === "score"
            ? b.score - a.score
            : this.relevance(b, query) - this.relevance(a, query),
    );
    return structuredClone(values);
  }

  private relevance(item: PackageSummary, query: string) {
    if (!query) return item.score + Math.log10(item.downloads30d + 1) * 10;
    const q = query.toLowerCase();
    return (
      (item.name === q ? 1000 : item.name.includes(q) ? 500 : 0) +
      (item.description.toLowerCase().includes(q) ? 100 : 0) +
      item.score
    );
  }

  async getPackage(name: string) {
    return structuredClone(this.details.get(name) ?? null);
  }
  async getVersion(name: string, version: string) {
    return structuredClone(
      this.details
        .get(name)
        ?.versions.find((item) => item.version === version) ?? null,
    );
  }
  async getFiles(name: string, version: string) {
    return (await this.getVersion(name, version))
      ? structuredClone(this.details.get(name)?.files ?? [])
      : null;
  }
  async getFile(
    name: string,
    version: string,
    path: string,
  ): Promise<PackageFile | null> {
    return (
      (await this.getFiles(name, version))?.find(
        (item) => item.path === path,
      ) ?? null
    );
  }
  async getScore(name: string, version: string) {
    return (await this.getVersion(name, version))
      ? structuredClone(this.details.get(name)?.score ?? null)
      : null;
  }
  async setRetraction(name: string, version: string, retracted: boolean) {
    const detail = this.details.get(name);
    const item = detail?.versions.find((entry) => entry.version === version);
    if (!item || !detail) return null;
    item.retractedAt = retracted ? new Date().toISOString() : null;
    const latest = selectLatestRelease(detail.versions);
    if (latest) {
      detail.latestVersion = latest;
      detail.package.latestVersion = latest.version;
    }
    return structuredClone(item);
  }
  async setDiscontinued(name: string, discontinued: boolean) {
    const item = this.details.get(name)?.package;
    if (!item) return null;
    item.isDiscontinued = discontinued;
    return structuredClone(item);
  }
  async createImport(
    input: Omit<ImportJobRecord, "id" | "status" | "createdAt">,
  ) {
    const job: ImportJobRecord = {
      ...input,
      id: `imp_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    this.imports.set(job.id, job);
    return structuredClone(job);
  }
  async getImport(id: string) {
    return structuredClone(this.imports.get(id) ?? null);
  }
  async listImports() {
    return structuredClone(
      [...this.imports.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    );
  }
  async findAccountByUsername(username: string) {
    return structuredClone(
      [...this.accounts.values()].find((item) => item.username === username) ??
        null,
    );
  }
  async listAccounts() {
    return structuredClone(
      [...this.accounts.values()].sort((a, b) =>
        a.username.localeCompare(b.username),
      ),
    );
  }
  async createAccount(input: {
    username: string;
    passwordHash: string;
    role: AccountRecord["role"];
    mustChangePassword: boolean;
  }) {
    if (
      [...this.accounts.values()].some(
        (item) => item.username === input.username,
      )
    )
      return null;
    const account: AccountRecord = {
      id: `account-${randomUUID()}`,
      username: input.username,
      passwordHash: input.passwordHash,
      role: input.role,
      mustChangePassword: input.mustChangePassword,
      isActive: true,
    };
    this.accounts.set(account.id, account);
    return structuredClone(account);
  }
  async createSession(accountId: string, tokenHash: string, expiresAt: string) {
    this.sessions.set(tokenHash, { accountId, expiresAt });
  }
  async authenticateSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
    return structuredClone(this.accounts.get(session.accountId) ?? null);
  }
  async revokeSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async updatePassword(accountId: string, passwordHash: string) {
    const account = this.accounts.get(accountId);
    if (account) {
      account.passwordHash = passwordHash;
      account.mustChangePassword = false;
    }
  }
  async listTokens(accountId: string) {
    return [...this.tokens.values()]
      .filter((item) => item.subjectId === accountId)
      .map((item) => ({
        id: item.id,
        name: item.name,
        prefix: item.prefix,
        scopes: item.scopes,
        expiresAt: item.expiresAt,
        lastUsedAt: null,
        revokedAt: item.revokedAt,
        createdAt: new Date().toISOString(),
      }));
  }
  async saveToken(token: TokenRecord) {
    this.tokens.set(token.id, token);
  }
  async authenticateToken(tokenHash: string) {
    const token = [...this.tokens.values()].find(
      (item) =>
        item.tokenHash === tokenHash &&
        !item.revokedAt &&
        (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()),
    );
    if (!token) return null;
    const account = this.accounts.get(token.subjectId);
    return {
      id: token.subjectId,
      username: account?.username,
      role: account?.role,
      scopes: token.scopes,
    };
  }
  async revokeToken(id: string, accountId: string) {
    const token = this.tokens.get(id);
    if (!token || token.subjectId !== accountId) return false;
    token.revokedAt = new Date().toISOString();
    return true;
  }
  async publishArchive(archive: Buffer, actor: PublishActor) {
    const parsed = await parsePackageArchive(archive);
    const existing = this.details.get(parsed.name);
    if (existing?.versions.some((item) => item.version === parsed.version))
      throw new Error(
        `Version ${parsed.version} of ${parsed.name} already exists.`,
      );
    if (this.storageDirectory) {
      const directory = resolve(this.storageDirectory);
      await mkdir(directory, { recursive: true });
      const destination = join(
        directory,
        `${parsed.name}-${parsed.version}.tar.gz`,
      );
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, archive, { flag: "wx" });
      await rename(temporary, destination);
    }
    this.registerParsedArchive(parsed, archive, actor);
    return {
      name: parsed.name,
      version: parsed.version,
      packageCreated: !existing,
    };
  }

  private registerParsedArchive(
    parsed: Awaited<ReturnType<typeof parsePackageArchive>>,
    archive: Buffer,
    actor: PublishActor,
  ) {
    const existing = this.details.get(parsed.name);
    if (existing?.versions.some((item) => item.version === parsed.version))
      throw new Error(
        `Version ${parsed.version} of ${parsed.name} already exists.`,
      );
    const publishedAt = new Date().toISOString();
    const packageVersion = {
      version: parsed.version,
      pubspec: parsed.pubspec,
      publishedAt,
      publishedBy: actor.username ?? actor.id,
      sdk: {
        dart: parsed.dartConstraint,
        ...(parsed.flutterConstraint
          ? { flutter: parsed.flutterConstraint }
          : {}),
      },
      platforms: parsed.flutterConstraint
        ? ["android", "ios", "web", "linux", "macos", "windows"]
        : ["android", "ios", "web", "linux", "macos", "windows"],
      archiveSha256: parsed.sha256,
      retractedAt: null,
      prerelease: Boolean(semver.prerelease(parsed.version)),
      releaseChannel: releaseChannel(parsed.version),
      sourceType: "native" as const,
    };
    const dependencies = parsed.dependencies.map((dependency) => ({
      ...dependency,
      registry:
        dependency.source === "sdk"
          ? ("sdk" as const)
          : dependency.source === "git"
            ? ("git" as const)
            : dependency.source === "path"
              ? ("path" as const)
              : this.details.has(dependency.name)
                ? ("private" as const)
                : ("pubdev" as const),
    }));
    const calculatedScore = scoreParsedPackage(parsed);
    if (existing) {
      existing.versions.push(packageVersion);
      existing.versions.sort((a, b) => semver.rcompare(a.version, b.version));
      if (selectLatestRelease(existing.versions)?.version === parsed.version) {
        existing.latestVersion = packageVersion;
        existing.package.latestVersion = parsed.version;
        existing.package.description = parsed.description;
        existing.package.updatedAt = publishedAt;
        existing.requirements = {
          dartSdkConstraint: parsed.dartConstraint,
          dartSdkMinimum: parsed.dartMinimum,
          flutterConstraint: parsed.flutterConstraint,
          flutterMinimum: parsed.flutterMinimum,
        };
        existing.dependencies = dependencies;
        existing.score = calculatedScore;
        existing.package.score = calculatedScore.grantedPoints;
        existing.package.hasPreview = parsed.files.some(
          (file) => file.preview !== "unsupported",
        );
        existing.readme = parsed.readme;
        existing.changelog = parsed.changelog;
        existing.files = parsed.files;
      }
    } else {
      this.details.set(parsed.name, {
        package: {
          name: parsed.name,
          publisherId: "local.private",
          description: parsed.description,
          latestVersion: parsed.version,
          isDiscontinued: false,
          topics: [parsed.flutterConstraint ? "flutter" : "dart"],
          updatedAt: publishedAt,
          downloads30d: 0,
          score: calculatedScore.grantedPoints,
          hasPreview: parsed.files.some(
            (file) => file.preview !== "unsupported",
          ),
        },
        latestVersion: packageVersion,
        versions: [packageVersion],
        requirements: {
          dartSdkConstraint: parsed.dartConstraint,
          dartSdkMinimum: parsed.dartMinimum,
          flutterConstraint: parsed.flutterConstraint,
          flutterMinimum: parsed.flutterMinimum,
        },
        dependencies,
        score: calculatedScore,
        readme: parsed.readme,
        changelog: parsed.changelog,
        files: parsed.files,
      });
    }
    this.archives.set(`${parsed.name}@${parsed.version}`, Buffer.from(archive));
  }
  async getArchive(name: string, version: string) {
    return this.archives.get(`${name}@${version}`) ?? null;
  }
}

export function hashToken(token: string, pepper: string) {
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}
