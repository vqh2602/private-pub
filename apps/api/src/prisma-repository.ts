import { AccountRole as DatabaseAccountRole, DependencyScope, JobStatus, PreviewStatus, Prisma, PrismaClient, type PackageFile as DatabaseFile, type PackageVersion as DatabaseVersion, type Score as DatabaseScore } from "@prisma/client";
import type { PackageDetail, PackageFile, PackageSummary, PackageVersion, Score } from "@private-pub/contracts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import semver from "semver";
import { parsePackageArchive, type ParsedPackageArchive } from "./archive.js";
import type { AccountRecord, ImportJobRecord, PublishActor, RegistryRepository, TokenRecord } from "./domain.js";
import { hashPassword } from "./password.js";
import { calculatePackageScore, SCORE_WEIGHTS, scoreParsedPackage } from "./scoring.js";
import { releaseChannel, selectLatestRelease } from "./release-channel.js";

type DatabasePackage = Prisma.PackageGetPayload<{
  include: {
    publisher: true;
    versions: { include: { files: true; scores: true; dependencies: true } };
  };
}>;

const emptyScore: Score = {
  grantedPoints: 0,
  maxPoints: 160,
  qualityScore: 0,
  popularityScore: 0,
  maintenanceScore: 0,
  tags: [],
  breakdown: [],
};

export class PrismaRegistryRepository implements RegistryRepository {
  readonly mode = "database" as const;
  private readonly prisma = new PrismaClient();
  private readonly storageDirectory: string;

  constructor(storageDirectory: string) {
    this.storageDirectory = resolve(storageDirectory);
  }

  async initialize() {
    await mkdir(this.storageDirectory, { recursive: true });
    await this.prisma.$connect();
    // Fail during startup when migrations have not created the registry tables.
    await this.prisma.package.count();
    if ((await this.prisma.account.count()) === 0) {
      const username = process.env.DEFAULT_ADMIN_USERNAME ?? "admin";
      const password = process.env.DEFAULT_ADMIN_PASSWORD ?? "admin";
      await this.prisma.account.create({
        data: {
          username,
          passwordHash: await hashPassword(password),
          role: DatabaseAccountRole.SUPER_ADMIN,
          mustChangePassword: true,
        },
      });
      console.warn(`[security] Created initial super-admin account '${username}'. Change its default password immediately.`);
    }
    await this.backfillEmptyScores();
  }

  async close() {
    await this.prisma.$disconnect();
  }

  async getStats() {
    const [packages, versions, analyzedVersions] = await this.prisma.$transaction([
      this.prisma.package.count(),
      this.prisma.packageVersion.count(),
      this.prisma.packageVersion.count({
        where: { scores: { some: {} } },
      }),
    ]);
    return { packages, versions, analyzedVersions };
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
    const packages = await this.prisma.package.findMany({
      where: {
        ...(query
          ? {
              OR: [{ name: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }],
            }
          : {}),
        ...(filters.publisher ? { publisher: { publisherId: filters.publisher } } : {}),
      },
      include: {
        publisher: true,
        versions: {
          include: {
            files: true,
            scores: { orderBy: { computedAt: "desc" }, take: 1 },
            dependencies: true,
          },
        },
      },
    });
    let summaries = packages.map((item) => this.summary(item)).filter((item): item is PackageSummary => Boolean(item));
    summaries = summaries.filter((summary) => {
      const source = packages.find((item) => item.name === summary.name)!;
      const latest = selectLatest(source.versions)!;
      const pubspec = jsonRecord(latest.pubspecJson);
      const isFlutter = Boolean(jsonRecord(pubspec.dependencies).flutter) || Boolean(jsonRecord(pubspec.environment).flutter) || Boolean(pubspec.flutter);
      const platforms = platformsFromPubspec(pubspec);
      return (!filters.sdk?.length || filters.sdk.includes(isFlutter ? "flutter" : "dart")) && (!filters.platform?.length || filters.platform.some((platform) => (platform === "desktop" ? platforms.some((value) => ["linux", "macos", "windows"].includes(value)) : platforms.includes(platform)))) && (filters.hasPreview === undefined || summary.hasPreview === filters.hasPreview) && (filters.verifiedPublisher === undefined || Boolean(source.publisher?.verifiedAt) === filters.verifiedPublisher) && (filters.minScore === undefined || summary.score >= filters.minScore);
    });
    const sort = filters.sort ?? "relevance";
    summaries.sort((a, b) => (sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : sort === "downloads" ? b.downloads30d - a.downloads30d : sort === "score" ? b.score - a.score : relevance(b, query) - relevance(a, query)));
    return summaries;
  }

  async getPackage(name: string): Promise<PackageDetail | null> {
    const item = await this.prisma.package.findUnique({
      where: { name },
      include: {
        publisher: true,
        versions: {
          include: {
            files: true,
            scores: { orderBy: { computedAt: "desc" }, take: 1 },
            dependencies: true,
          },
        },
      },
    });
    if (!item) return null;
    const latest = selectLatest(item.versions);
    const summary = this.summary(item);
    if (!latest || !summary) return null;
    const pubspec = jsonRecord(latest.pubspecJson);
    const environment = jsonRecord(pubspec.environment);
    const dartConstraint = String(environment.sdk ?? "any");
    const flutterConstraint = environment.flutter ? String(environment.flutter) : null;
    const privateNames = await this.privatePackageNames(latest.dependencies.map((dependency) => dependency.name));
    return {
      package: summary,
      latestVersion: mapVersion(latest),
      versions: item.versions.sort(compareDatabaseVersions).map(mapVersion),
      requirements: {
        dartSdkConstraint: dartConstraint,
        dartSdkMinimum: minimumVersion(dartConstraint),
        flutterConstraint,
        flutterMinimum: flutterConstraint ? minimumVersion(flutterConstraint) : null,
      },
      dependencies: latest.dependencies.map((dependency) => ({
        name: dependency.name,
        constraint: dependency.constraintRaw,
        scope: dependencyScopeFromDatabase(dependency.scope),
        source: sourceFromDatabase(dependency.sourceKind),
        registry: registryFor(dependency.sourceKind, dependency.name, privateNames),
      })),
      score: scoreFromDatabase(latest.scores[0]),
      readme: latest.readmeHtml ?? `# ${item.name}`,
      changelog: latest.changelogHtml ?? "# Changelog\n\nNo changelog was included.",
      files: await Promise.all(latest.files.sort((a, b) => a.sortOrder - b.sortOrder).map((file) => this.mapFile(file))),
    };
  }

  async getVersion(name: string, version: string) {
    const item = await this.prisma.packageVersion.findFirst({
      where: { package: { name }, version },
    });
    return item ? mapVersion(item) : null;
  }

  async getFiles(name: string, version: string) {
    const item = await this.prisma.packageVersion.findFirst({
      where: { package: { name }, version },
      include: { files: { orderBy: { sortOrder: "asc" } } },
    });
    return item ? Promise.all(item.files.map((file) => this.mapFile(file))) : null;
  }

  async getFile(name: string, version: string, path: string) {
    const item = await this.prisma.packageFile.findFirst({
      where: { version: { package: { name }, version }, path },
    });
    return item ? this.mapFile(item) : null;
  }

  async getScore(name: string, version: string) {
    const item = await this.prisma.score.findFirst({
      where: { version: { package: { name }, version } },
      orderBy: { computedAt: "desc" },
    });
    return item ? scoreFromDatabase(item) : null;
  }

  async setRetraction(name: string, version: string, retracted: boolean) {
    const item = await this.prisma.packageVersion.findFirst({
      where: { package: { name }, version },
      select: { id: true },
    });
    if (!item) return null;
    const updated = await this.prisma.packageVersion.update({
      where: { id: item.id },
      data: { retractedAt: retracted ? new Date() : null },
    });
    return mapVersion(updated);
  }

  async setDiscontinued(name: string, discontinued: boolean) {
    const result = await this.prisma.package.updateMany({
      where: { name },
      data: { isDiscontinued: discontinued },
    });
    if (!result.count) return null;
    const item = await this.prisma.package.findUnique({
      where: { name },
      include: {
        publisher: true,
        versions: {
          include: {
            files: true,
            scores: { orderBy: { computedAt: "desc" }, take: 1 },
            dependencies: true,
          },
        },
      },
    });
    return item ? this.summary(item) : null;
  }

  async createImport(input: Omit<ImportJobRecord, "id" | "status" | "createdAt">) {
    const item = await this.prisma.importJob.create({
      data: {
        sourceRegistry: "pub.dev",
        packageName: input.packageName,
        mode: input.mode,
        requestedVersionsJson: input.versions,
        status: JobStatus.QUEUED,
      },
    });
    return mapImport(item);
  }

  async getImport(id: string) {
    const item = await this.prisma.importJob.findUnique({ where: { id } });
    return item ? mapImport(item) : null;
  }

  async listImports() {
    return (await this.prisma.importJob.findMany({ orderBy: { createdAt: "desc" } })).map(mapImport);
  }

  async findAccountByUsername(username: string) {
    const item = await this.prisma.account.findUnique({ where: { username } });
    return item ? mapAccount(item) : null;
  }

  async createSession(accountId: string, tokenHash: string, expiresAt: string) {
    await this.prisma.authSession.create({
      data: { accountId, tokenHash, expiresAt: new Date(expiresAt) },
    });
  }

  async authenticateSession(tokenHash: string) {
    const item = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: { account: true },
    });
    if (!item || item.expiresAt <= new Date() || !item.account.isActive) return null;
    await this.prisma.authSession.update({
      where: { id: item.id },
      data: { lastSeenAt: new Date() },
    });
    return mapAccount(item.account);
  }

  async revokeSession(tokenHash: string) {
    await this.prisma.authSession.deleteMany({ where: { tokenHash } });
  }

  async updatePassword(accountId: string, passwordHash: string) {
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: accountId },
        data: { passwordHash, mustChangePassword: false },
      }),
      this.prisma.authSession.deleteMany({ where: { accountId } }),
    ]);
  }

  async listTokens(accountId: string) {
    return (
      await this.prisma.apiToken.findMany({
        where: { accountId },
        orderBy: { createdAt: "desc" },
      })
    ).map((item) => ({
      id: item.publicId,
      name: item.name,
      prefix: item.prefix,
      scopes: stringArray(item.scopesJson),
      expiresAt: item.expiresAt?.toISOString() ?? null,
      lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
      revokedAt: item.revokedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    }));
  }

  async saveToken(token: TokenRecord) {
    await this.prisma.apiToken.create({
      data: {
        publicId: token.id,
        subjectId: token.subjectId,
        accountId: token.subjectId,
        name: token.name,
        tokenHash: token.tokenHash,
        prefix: token.prefix,
        scopesJson: token.scopes,
        expiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
        revokedAt: token.revokedAt ? new Date(token.revokedAt) : null,
      },
    });
  }

  async authenticateToken(tokenHash: string) {
    const item = await this.prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { account: true },
    });
    if (!item?.account?.isActive || item.revokedAt || (item.expiresAt && item.expiresAt <= new Date())) return null;
    await this.prisma.apiToken.update({
      where: { id: item.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      id: item.account.id,
      username: item.account.username,
      role: mapAccount(item.account).role,
      scopes: stringArray(item.scopesJson),
    };
  }

  async revokeToken(id: string, accountId: string) {
    const result = await this.prisma.apiToken.updateMany({
      where: { publicId: id, accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async publishArchive(archive: Buffer, actor: PublishActor) {
    const parsed = await parsePackageArchive(archive);
    const existingPackage = await this.prisma.package.findUnique({
      where: { name: parsed.name },
      select: { id: true },
    });
    const duplicate = await this.prisma.packageVersion.findFirst({
      where: { package: { name: parsed.name }, version: parsed.version },
      select: { id: true },
    });
    if (duplicate) throw new Error(`Version ${parsed.version} of ${parsed.name} already exists.`);

    const archivePath = join(this.storageDirectory, `${parsed.name}-${parsed.version}.tar.gz`);
    const temporaryPath = `${archivePath}.${randomUUID()}.tmp`;
    const previewDirectory = join(this.storageDirectory, "files", parsed.name, parsed.version);
    await mkdir(dirname(archivePath), { recursive: true });
    await mkdir(previewDirectory, { recursive: true });
    await writeFile(temporaryPath, archive, { flag: "wx" });
    await rename(temporaryPath, archivePath);
    const files = await Promise.all(
      parsed.files.map(async (file, index) => {
        const previewPath = file.content === undefined ? `${archivePath}#${file.path}` : join(previewDirectory, `${createHash("sha256").update(file.path).digest("hex")}.txt`);
        if (file.content !== undefined) await writeFile(previewPath, file.content, "utf8");
        return {
          path: file.path,
          kind: file.type,
          sizeBytes: BigInt(file.size ?? 0),
          mimeType: null,
          sha256: createHash("sha256")
            .update(file.content ?? `${file.path}:${file.size ?? 0}`)
            .digest("hex"),
          storageKey: previewPath,
          isText: file.content !== undefined,
          language: file.language,
          previewStatus: file.preview && file.preview !== "unsupported" ? PreviewStatus.READY : PreviewStatus.UNSUPPORTED,
          sortOrder: index,
        };
      }),
    );

    try {
      await this.persistPackage(parsed, archivePath, files, actor);
    } catch (error) {
      await rm(archivePath, { force: true });
      await rm(previewDirectory, { recursive: true, force: true });
      throw error;
    }
    return {
      name: parsed.name,
      version: parsed.version,
      packageCreated: !existingPackage,
    };
  }

  async getArchive(name: string, version: string) {
    const item = await this.prisma.packageVersion.findFirst({
      where: { package: { name }, version },
      select: { archiveObjectKey: true },
    });
    if (!item) return null;
    try {
      return await readFile(item.archiveObjectKey);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  private async persistPackage(
    parsed: ParsedPackageArchive,
    archivePath: string,
    files: Array<{
      path: string;
      kind: string;
      sizeBytes: bigint;
      mimeType: null;
      sha256: string;
      storageKey: string;
      isText: boolean;
      language?: string;
      previewStatus: PreviewStatus;
      sortOrder: number;
    }>,
    actor: PublishActor,
  ) {
    const publishedAt = new Date();
    const topics = stringArray(parsed.pubspec.topics);
    const platforms = platformsFromPubspec(parsed.pubspec);
    const calculatedScore = scoreParsedPackage(parsed);
    await this.prisma.$transaction(async (transaction) => {
      const publisher = await transaction.publisher.upsert({
        where: { publisherId: "local.private" },
        update: {},
        create: {
          publisherId: "local.private",
          displayName: "Local private registry",
        },
      });
      const packageRecord = await transaction.package.upsert({
        where: { name: parsed.name },
        update: {
          description: parsed.description,
          topics,
          publisherId: publisher.id,
        },
        create: {
          name: parsed.name,
          normalizedName: parsed.name.toLowerCase(),
          description: parsed.description,
          topics,
          publisherId: publisher.id,
        },
      });
      const versionRecord = await transaction.packageVersion.create({
        data: {
          packageId: packageRecord.id,
          version: parsed.version,
          versionSortKey: parsed.version,
          pubspecJson: parsed.pubspec as Prisma.InputJsonObject,
          readmeHtml: parsed.readme,
          changelogHtml: parsed.changelog,
          archiveObjectKey: archivePath,
          archiveSha256: parsed.sha256,
          publishedAt,
          publishedBy: actor.username ?? actor.id,
          isPrerelease: Boolean(semver.prerelease(parsed.version)),
          sourceType: "native",
        },
      });
      if (files.length)
        await transaction.packageFile.createMany({
          data: files.map((file) => ({
            ...file,
            packageVersionId: versionRecord.id,
          })),
        });
      if (parsed.dependencies.length)
        await transaction.dependency.createMany({
          data: parsed.dependencies.map((dependency) => ({
            packageVersionId: versionRecord.id,
            scope: dependencyScopeToDatabase(dependency.scope),
            name: dependency.name,
            sourceKind: dependency.source,
            constraintRaw: dependency.constraint,
            isDirect: true,
          })),
        });
      await transaction.score.create({
        data: {
          packageVersionId: versionRecord.id,
          ...scoreData(calculatedScore),
        },
      });
      const versions = await transaction.packageVersion.findMany({
        where: { packageId: packageRecord.id },
        select: { id: true, version: true, retractedAt: true },
      });
      const latest = selectLatestRelease(versions)!;
      await transaction.package.update({
        where: { id: packageRecord.id },
        data: { latestVersionId: latest.id },
      });
      await transaction.searchDocument.upsert({
        where: { packageId: packageRecord.id },
        update: {
          packageVersionId: latest.id,
          name: parsed.name,
          description: parsed.description,
          readmeExcerpt: parsed.readme.slice(0, 500),
          topicsJson: topics,
          publisherIdentifier: publisher.publisherId,
          platformsJson: platforms,
          tagsJson: [],
          rankingFeaturesJson: {},
        },
        create: {
          packageId: packageRecord.id,
          packageVersionId: latest.id,
          name: parsed.name,
          description: parsed.description,
          readmeExcerpt: parsed.readme.slice(0, 500),
          topicsJson: topics,
          publisherIdentifier: publisher.publisherId,
          platformsJson: platforms,
          tagsJson: [],
          rankingFeaturesJson: {},
        },
      });
      await transaction.auditLog.create({
        data: {
          subjectType: "package_version",
          subjectId: `${parsed.name}@${parsed.version}`,
          actorId: actor.id,
          action: "package.publish",
          payloadJson: {
            sha256: parsed.sha256,
            publishedBy: actor.username ?? actor.id,
          },
        },
      });
    });
  }

  private async backfillEmptyScores() {
    const versions = await this.prisma.packageVersion.findMany({
      where: { scores: { some: {} } },
      include: {
        files: { select: { path: true } },
        dependencies: true,
        scores: { orderBy: { computedAt: "desc" }, take: 1 },
      },
    });
    for (const version of versions) {
      const current = version.scores[0];
      if (!current) continue;
      const emptyScore = current.grantedPoints === 0 && (!Array.isArray(current.breakdownJson) || current.breakdownJson.length === 0);
      const automaticScoreNeedsDetails = isAutomaticPackageScore(current.weightsJson) && !hasScoreDetails(current.breakdownJson);
      if (!emptyScore && !automaticScoreNeedsDetails) continue;
      const pubspec = jsonRecord(version.pubspecJson);
      const calculated = calculatePackageScore({
        pubspec,
        description: String(pubspec.description ?? ""),
        readme: version.readmeHtml ?? "",
        changelog: version.changelogHtml ?? "",
        files: version.files,
        dependencies: version.dependencies.map((dependency) => ({
          name: dependency.name,
          constraint: dependency.constraintRaw,
          scope: dependencyScopeFromDatabase(dependency.scope),
          source: sourceFromDatabase(dependency.sourceKind),
        })),
        downloads30d: current.downloadCount30d,
      });
      await this.prisma.score.update({
        where: { id: current.id },
        data: scoreData(calculated),
      });
    }
  }

  private summary(item: DatabasePackage): PackageSummary | null {
    const latest = selectLatest(item.versions);
    if (!latest) return null;
    const score = scoreFromDatabase(latest.scores[0]);
    return {
      name: item.name,
      publisherId: item.publisher?.publisherId ?? "local.private",
      description: item.description ?? "No description provided.",
      latestVersion: latest.version,
      isDiscontinued: item.isDiscontinued,
      topics: stringArray(item.topics),
      updatedAt: item.updatedAt.toISOString(),
      downloads30d: latest.scores[0]?.downloadCount30d ?? 0,
      score: score.grantedPoints,
      hasPreview: latest.files.some((file) => file.previewStatus === PreviewStatus.READY),
    };
  }

  private async mapFile(file: DatabaseFile): Promise<PackageFile> {
    let content: string | undefined;
    if (file.isText) {
      try {
        content = await readFile(file.storageKey, "utf8");
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
    const preview = file.previewStatus === PreviewStatus.READY ? previewForLanguage(file.language) : ("unsupported" as const);
    return {
      path: file.path,
      type: file.kind === "dir" ? "dir" : "file",
      size: Number(file.sizeBytes),
      language: file.language ?? undefined,
      preview,
      content,
    };
  }

  private async privatePackageNames(names: string[]) {
    if (!names.length) return new Set<string>();
    return new Set(
      (
        await this.prisma.package.findMany({
          where: { name: { in: names } },
          select: { name: true },
        })
      ).map((item) => item.name),
    );
  }
}

function mapVersion(item: DatabaseVersion): PackageVersion {
  const pubspec = jsonRecord(item.pubspecJson);
  const environment = jsonRecord(pubspec.environment);
  return {
    version: item.version,
    pubspec,
    publishedAt: item.publishedAt.toISOString(),
    publishedBy: item.publishedBy,
    sdk: {
      dart: String(environment.sdk ?? "any"),
      ...(environment.flutter ? { flutter: String(environment.flutter) } : {}),
    },
    platforms: platformsFromPubspec(pubspec),
    archiveSha256: item.archiveSha256,
    retractedAt: item.retractedAt?.toISOString() ?? null,
    prerelease: item.isPrerelease,
    releaseChannel: releaseChannel(item.version),
    sourceType: item.sourceType === "pubdev_import" ? "pubdev_import" : "native",
  };
}

function scoreFromDatabase(item?: DatabaseScore): Score {
  if (!item) return structuredClone(emptyScore);
  return {
    grantedPoints: item.grantedPoints,
    maxPoints: item.maxPoints,
    qualityScore: item.qualityScore,
    popularityScore: item.popularityScore,
    maintenanceScore: item.maintenanceScore,
    tags: stringArray(item.tagsJson),
    breakdown: Array.isArray(item.breakdownJson) ? (item.breakdownJson as Score["breakdown"]) : [],
  };
}

function scoreData(score: Score) {
  return {
    grantedPoints: score.grantedPoints,
    maxPoints: score.maxPoints,
    qualityScore: score.qualityScore,
    popularityScore: score.popularityScore,
    maintenanceScore: score.maintenanceScore,
    tagsJson: score.tags as Prisma.InputJsonArray,
    weightsJson: SCORE_WEIGHTS as Prisma.InputJsonObject,
    breakdownJson: score.breakdown as Prisma.InputJsonArray,
  };
}

function isAutomaticPackageScore(value: Prisma.JsonValue) {
  const weights = jsonRecord(value);
  return ["conventions", "documentation", "platforms", "analysis", "dependencies"].every((key) => typeof weights[key] === "number");
}

function hasScoreDetails(value: Prisma.JsonValue) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => {
      const breakdown = jsonRecord(item);
      return Array.isArray(breakdown.details);
    })
  );
}

function mapImport(item: { id: string; packageName: string; mode: string; status: JobStatus; requestedVersionsJson: Prisma.JsonValue; summaryJson: Prisma.JsonValue | null; createdAt: Date }): ImportJobRecord {
  return {
    id: item.id,
    packageName: item.packageName,
    versions: stringArray(item.requestedVersionsJson),
    mode: item.mode,
    status: item.status.toLowerCase() as ImportJobRecord["status"],
    createdAt: item.createdAt.toISOString(),
    ...(item.summaryJson && typeof item.summaryJson === "object" && !Array.isArray(item.summaryJson) ? { summary: item.summaryJson as Record<string, unknown> } : {}),
  };
}

function selectLatest<T extends { version: string; retractedAt?: unknown }>(versions: T[]) {
  return selectLatestRelease(versions);
}
function compareDatabaseVersions(a: DatabaseVersion, b: DatabaseVersion) {
  return semver.rcompare(a.version, b.version);
}
function relevance(item: PackageSummary, query: string) {
  const value = query.toLowerCase();
  return (item.name === value ? 1000 : item.name.includes(value) ? 500 : 0) + (item.description.toLowerCase().includes(value) ? 100 : 0) + item.score;
}
function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function minimumVersion(constraint: string) {
  return constraint.match(/\d+\.\d+\.\d+/)?.[0] ?? constraint;
}
function platformsFromPubspec(pubspec: Record<string, unknown>) {
  const declared = Object.keys(jsonRecord(pubspec.platforms));
  return declared.length ? declared : pubspec.flutter || jsonRecord(pubspec.dependencies).flutter ? ["android", "ios", "web", "linux", "macos", "windows"] : [];
}
function dependencyScopeToDatabase(scope: "dependencies" | "dev_dependencies" | "dependency_overrides") {
  return scope === "dev_dependencies" ? DependencyScope.DEV_DEPENDENCIES : scope === "dependency_overrides" ? DependencyScope.DEPENDENCY_OVERRIDES : DependencyScope.DEPENDENCIES;
}
function dependencyScopeFromDatabase(scope: DependencyScope) {
  return scope === DependencyScope.DEV_DEPENDENCIES ? ("dev_dependencies" as const) : scope === DependencyScope.DEPENDENCY_OVERRIDES ? ("dependency_overrides" as const) : ("dependencies" as const);
}
function sourceFromDatabase(source: string) {
  return source === "sdk" || source === "git" || source === "path" ? source : ("hosted" as const);
}
function registryFor(source: string, name: string, privateNames: Set<string>) {
  return source === "sdk" ? ("sdk" as const) : source === "git" ? ("git" as const) : source === "path" ? ("path" as const) : privateNames.has(name) ? ("private" as const) : ("pubdev" as const);
}
function previewForLanguage(language: string | null): PackageFile["preview"] {
  return language === "markdown" ? "markdown" : language === "yaml" || language === "json" ? "structured" : language === "image" ? "image" : "code";
}
function mapAccount(item: { id: string; username: string; passwordHash: string; role: DatabaseAccountRole; mustChangePassword: boolean; isActive: boolean }): AccountRecord {
  return {
    id: item.id,
    username: item.username,
    passwordHash: item.passwordHash,
    role: item.role === DatabaseAccountRole.SUPER_ADMIN ? "super_admin" : item.role === DatabaseAccountRole.ADMIN ? "admin" : "user",
    mustChangePassword: item.mustChangePassword,
    isActive: item.isActive,
  };
}
function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
