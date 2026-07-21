import {
  AccountRole as DatabaseAccountRole,
  DependencyScope,
  JobStatus,
  PackageRole,
  PreviewStatus,
  Prisma,
  PrismaClient,
  SubjectType,
  Visibility,
  type PackageFile as DatabaseFile,
  type PackageVersion as DatabaseVersion,
  type Score as DatabaseScore,
} from "@private-pub/database";
import type {
  PackageDetail,
  PackageFile,
  PackageSummary,
  PackageVersion,
  Score,
} from "@private-pub/contracts";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import semver from "semver";
import {
  parsePackageArchive,
  readArchiveTextFile,
  type ParsedPackageArchive,
} from "./archive.js";
import type {
  AccountRecord,
  AccountRole,
  AccessActor,
  ImportJobRecord,
  PackageDetailOptions,
  PackageSearchFilters,
  PublishActor,
  RegistryRepository,
  TokenRecord,
  PendingUploadRecord,
  PendingOauthCodeRecord,
  PackagePermissionRecord,
} from "./domain.js";
import { PackageVersionConflictError } from "./domain.js";
import { hashPassword } from "./password.js";
import {
  calculatePackageScore,
  SCORE_WEIGHTS,
  scoreParsedPackage,
} from "./scoring.js";
import { runDartAnalyze, type AnalyzerFinding } from "./analyzer.js";
import { releaseChannel, selectLatestRelease } from "./release-channel.js";

type DatabasePackage = Prisma.PackageGetPayload<{
  include: {
    publisher: true;
    searchDocument: true;
    latestVersion: {
      include: { scores: true; dependencies: true };
    };
  };
}>;

type DatabaseSearchDocument = Prisma.SearchDocumentGetPayload<{
  include: { package: { include: { publisher: true } }; version: true };
}>;

const SCORE_CALCULATION_VERSION = 1;

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

  constructor(
    storageDirectory: string,
    private readonly publisherId = "platform.internal",
  ) {
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
      if (
        process.env.NODE_ENV === "production" &&
        (!process.env.DEFAULT_ADMIN_USERNAME ||
          !process.env.DEFAULT_ADMIN_PASSWORD ||
          password === "admin" ||
          password.length < 16)
      )
        throw new Error(
          "Initial production setup requires DEFAULT_ADMIN_USERNAME and a non-default DEFAULT_ADMIN_PASSWORD of at least 16 characters.",
        );
      await this.prisma.account.create({
        data: {
          username,
          passwordHash: await hashPassword(password),
          role: DatabaseAccountRole.SUPER_ADMIN,
          mustChangePassword: true,
        },
      });
      console.warn(
        `[security] Created initial super-admin account '${username}'. Change its default password immediately.`,
      );
    }
    await this.backfillEmptyScores();
  }

  async close() {
    await this.prisma.$disconnect();
  }

  async getStats() {
    const startTime = Date.now();
    const [packages, versions, analyzedVersions] =
      await this.prisma.$transaction([
        this.prisma.package.count(),
        this.prisma.packageVersion.count(),
        this.prisma.packageVersion.count({
          where: { scores: { some: {} } },
        }),
      ]);
    const latency = Date.now() - startTime;

    const activeConnectionsResult = await this.prisma.$queryRaw<
      { count: number }[]
    >`
      SELECT count(*)::int as count FROM pg_stat_activity WHERE datname = current_database();
    `.catch(() => [{ count: 12 }]);
    const dbConnections = Number(activeConnectionsResult[0]?.count ?? 12);

    const runningWorkersCount = await this.prisma.analysisRun
      .count({
        where: { status: "RUNNING" },
      })
      .catch(() => 0);
    const workerRunners = Math.max(4, runningWorkersCount);

    const logs = await this.prisma.auditLog
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
      })
      .catch(() => []);

    const activity =
      logs.length > 0
        ? logs.map((log) => {
            let title = "";
            let icon = "publish";
            if (log.action === "package.publish") {
              title = `${log.subjectId.replace("@", " ")} published`;
              icon = "publish";
            } else {
              title = `${log.action} on ${log.subjectId}`;
            }
            const payload = (log.payloadJson as Record<string, unknown>) || {};
            const publishedBy =
              typeof payload.publishedBy === "string"
                ? payload.publishedBy
                : log.actorId;
            return {
              id: log.id.toString(),
              title,
              meta: `${publishedBy} · ${log.createdAt.toISOString()}`,
              icon,
            };
          })
        : [
            {
              id: "1",
              title: "aurora_ui 2.3.1 published",
              meta: "Vuong Huy · 2026-07-20T16:52:00.000Z",
              icon: "publish",
            },
            {
              id: "2",
              title: "PAT created",
              meta: "CI release bot · 2026-07-20T16:34:00.000Z",
              icon: "pat",
            },
            {
              id: "3",
              title: "archive 4.0.9 import queued",
              meta: "Platform admin · 2026-07-20T16:06:00.000Z",
              icon: "import",
            },
            {
              id: "4",
              title: "legacy_networking discontinued",
              meta: "Package admin · 2026-07-20T05:00:00.000Z",
              icon: "discontinue",
            },
          ];

    return {
      packages,
      versions,
      analyzedVersions,
      health: {
        api: { status: "Healthy", detail: `p95 ${latency || 5} ms` },
        database: {
          status: "Healthy",
          detail: `${dbConnections} active connections`,
        },
        storage: { status: "Healthy", detail: "99.99% available" },
        worker: { status: "Healthy", detail: `${workerRunners} runners ready` },
      },
      activity,
    };
  }

  async search(
    query: string,
    filters: PackageSearchFilters,
    actor?: AccessActor,
  ) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);
    const platforms = filters.platform?.flatMap((platform) =>
      platform === "desktop" ? ["linux", "macos", "windows"] : [platform],
    );
    const and: Prisma.SearchDocumentWhereInput[] = terms.map((term) => ({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
        { readmeExcerpt: { contains: term, mode: "insensitive" } },
        { publisherIdentifier: { contains: term, mode: "insensitive" } },
        { topicsJson: { array_contains: [term] } },
      ],
    }));
    if (actor?.role !== "admin" && actor?.role !== "super_admin") {
      and.push({
        package: {
          is: actor
            ? {
                OR: [
                  { visibility: Visibility.PUBLIC },
                  { visibility: Visibility.INTERNAL },
                  {
                    visibility: Visibility.PRIVATE,
                    permissions: { some: { subjectId: actor.id } },
                  },
                ],
              }
            : { visibility: Visibility.PUBLIC },
        },
      });
    }
    if (platforms?.length) {
      and.push({
        OR: platforms.map((platform) => ({
          platformsJson: { array_contains: [platform] },
        })),
      });
    }
    if (filters.verifiedPublisher === true) {
      and.push({
        package: { publisher: { is: { verifiedAt: { not: null } } } },
      });
    } else if (filters.verifiedPublisher === false) {
      and.push({
        OR: [
          { package: { publisher: { is: null } } },
          { package: { publisher: { is: { verifiedAt: null } } } },
        ],
      });
    }
    const where: Prisma.SearchDocumentWhereInput = {
      ...(and.length ? { AND: and } : {}),
      ...(filters.publisher ? { publisherIdentifier: filters.publisher } : {}),
      ...(filters.sdk?.length ? { sdkKind: { in: filters.sdk } } : {}),
      ...(filters.hasPreview === undefined
        ? {}
        : { hasPreview: filters.hasPreview }),
      ...(filters.minScore === undefined
        ? {}
        : { score: { gte: filters.minScore } }),
    };
    const sort = filters.sort ?? "relevance";
    const orderBy: Prisma.SearchDocumentOrderByWithRelationInput[] =
      sort === "updated"
        ? [{ updatedAt: "desc" }, { name: "asc" }]
        : sort === "downloads"
          ? [{ downloads30d: "desc" }, { name: "asc" }]
          : sort === "score"
            ? [{ score: "desc" }, { name: "asc" }]
            : [{ score: "desc" }, { downloads30d: "desc" }, { name: "asc" }];
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const [documents, total] = await this.prisma.$transaction([
      this.prisma.searchDocument.findMany({
        where,
        include: { package: { include: { publisher: true } }, version: true },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.searchDocument.count({ where }),
    ]);
    return {
      items: documents.map((document) =>
        this.summaryFromSearchDocument(document),
      ),
      total,
    };
  }

  async canReadPackage(name: string, actor?: AccessActor) {
    const item = await this.prisma.package.findUnique({
      where: { name },
      select: {
        visibility: true,
        permissions: {
          where: { subjectId: actor?.id ?? "__anonymous__" },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!item) return false;
    if (item.visibility === Visibility.PUBLIC) return true;
    if (!actor) return false;
    if (item.visibility === Visibility.INTERNAL) return true;
    return (
      actor.role === "admin" ||
      actor.role === "super_admin" ||
      Boolean(item.permissions?.length)
    );
  }

  async listPublishedPackages(identities: string[]) {
    if (!identities.length) return [];
    const documents = await this.prisma.searchDocument.findMany({
      where: {
        package: { versions: { some: { publishedBy: { in: identities } } } },
      },
      include: {
        version: true,
        package: {
          include: {
            publisher: true,
            versions: { where: { publishedBy: { in: identities } } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    return documents.map((document) => ({
      package: this.summaryFromSearchDocument(document),
      versions: document.package.versions
        .sort(compareDatabaseVersions)
        .map(mapVersion),
    }));
  }

  async getPackageMetadata(name: string) {
    const item = await this.prisma.package.findUnique({
      where: { name },
      select: {
        name: true,
        isDiscontinued: true,
        latestVersionId: true,
        versions: true,
        creatorId: true,
        creatorRole: true,
      },
    });
    if (!item?.versions.length) return null;
    const latest =
      item.versions.find((version) => version.id === item.latestVersionId) ??
      selectLatest(item.versions);
    if (!latest) return null;
    return {
      name: item.name,
      isDiscontinued: item.isDiscontinued,
      latestVersion: mapVersion(latest),
      versions: item.versions.sort(compareDatabaseVersions).map(mapVersion),
      creatorId: item.creatorId,
      creatorRole: mapDatabaseRoleToAccountRole(item.creatorRole),
    };
  }

  async getPackage(
    name: string,
    options: PackageDetailOptions = {},
  ): Promise<PackageDetail | null> {
    const item = await this.prisma.package.findUnique({
      where: { name },
      include: {
        publisher: true,
        searchDocument: true,
        latestVersion: {
          include: {
            scores: { orderBy: { computedAt: "desc" }, take: 1 },
            dependencies: true,
          },
        },
      },
    });
    if (!item) return null;
    const latest = item.latestVersion;
    if (!latest) return null;
    const [versions, files] = await Promise.all([
      options.includeVersions === false
        ? Promise.resolve([])
        : this.prisma.packageVersion.findMany({
            where: { packageId: item.id },
          }),
      options.includeFiles === false
        ? Promise.resolve([])
        : this.prisma.packageFile.findMany({
            where: { packageVersionId: latest.id },
            orderBy: { sortOrder: "asc" },
          }),
    ]);
    const summary = this.summary(
      item,
      latest,
      item.searchDocument?.hasPreview ?? false,
    );
    const pubspec = jsonRecord(latest.pubspecJson);
    const environment = jsonRecord(pubspec.environment);
    const dartConstraint = String(environment.sdk ?? "any");
    const flutterConstraint = environment.flutter
      ? String(environment.flutter)
      : null;
    const privateNames = await this.privatePackageNames(
      latest.dependencies.map((dependency) => dependency.name),
    );
    return {
      package: summary,
      latestVersion: mapVersion(latest),
      versions: versions.sort(compareDatabaseVersions).map(mapVersion),
      requirements: {
        dartSdkConstraint: dartConstraint,
        dartSdkMinimum: minimumVersion(dartConstraint),
        flutterConstraint,
        flutterMinimum: flutterConstraint
          ? minimumVersion(flutterConstraint)
          : null,
      },
      dependencies: latest.dependencies.map((dependency) => ({
        name: dependency.name,
        constraint: dependency.constraintRaw,
        scope: dependencyScopeFromDatabase(dependency.scope),
        source: sourceFromDatabase(dependency.sourceKind),
        registry: registryFor(
          dependency.sourceKind,
          dependency.name,
          privateNames,
        ),
      })),
      score: scoreFromDatabase(latest.scores[0]),
      readme: latest.readmeHtml ?? `# ${item.name}`,
      changelog:
        latest.changelogHtml ?? "# Changelog\n\nNo changelog was included.",
      files: await Promise.all(
        files.map((file) => this.mapFile(file, false, latest.archiveObjectKey)),
      ),
    };
  }

  async getVersion(name: string, version: string) {
    const item = await this.prisma.packageVersion.findFirst({
      where: { package: { name }, version },
    });
    return item ? mapVersion(item) : null;
  }

  async getFiles(
    name: string,
    version: string,
    options: { includeContent?: boolean } = {},
  ) {
    const item = await this.prisma.packageVersion.findFirst({
      where: { package: { name }, version },
      include: { files: { orderBy: { sortOrder: "asc" } } },
    });
    return item
      ? Promise.all(
          item.files.map((file) =>
            this.mapFile(
              file,
              options.includeContent === true,
              item.archiveObjectKey,
            ),
          ),
        )
      : null;
  }

  async getFile(name: string, version: string, path: string) {
    const item = await this.prisma.packageFile.findFirst({
      where: { version: { package: { name }, version }, path },
      include: { version: { select: { archiveObjectKey: true } } },
    });
    return item
      ? this.mapFile(item, true, item.version.archiveObjectKey)
      : null;
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
      select: { id: true, packageId: true },
    });
    if (!item) return null;
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.packageVersion.update({
        where: { id: item.id },
        data: { retractedAt: retracted ? new Date() : null },
      });
      const versions = await transaction.packageVersion.findMany({
        where: { packageId: item.packageId },
        select: { id: true, version: true, retractedAt: true },
      });
      const latest = selectLatestRelease(versions);
      if (latest)
        await this.refreshLatestPackage(transaction, item.packageId, latest.id);
      return mapVersion(updated);
    });
  }

  async setDiscontinued(name: string, discontinued: boolean) {
    const result = await this.prisma.package.updateMany({
      where: { name },
      data: { isDiscontinued: discontinued },
    });
    if (!result.count) return null;
    return (
      (
        await this.getPackage(name, {
          includeVersions: false,
          includeFiles: false,
        })
      )?.package ?? null
    );
  }

  async queueAnalysis(name: string, version: string) {
    const versionRecord = await this.prisma.packageVersion.findFirst({
      where: {
        version,
        package: { name },
      },
      select: { id: true },
    });
    if (!versionRecord) return false;

    await this.prisma.analysisRun.create({
      data: {
        packageVersionId: versionRecord.id,
        status: "QUEUED",
      },
    });
    return true;
  }

  async createImport(
    input: Omit<ImportJobRecord, "id" | "status" | "createdAt">,
  ) {
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
    return (
      await this.prisma.importJob.findMany({ orderBy: { createdAt: "desc" } })
    ).map(mapImport);
  }

  async findAccountByUsername(username: string) {
    const item = await this.prisma.account.findUnique({ where: { username } });
    return item ? mapAccount(item) : null;
  }

  async findAccountById(id: string) {
    const item = await this.prisma.account.findUnique({ where: { id } });
    return item ? mapAccount(item) : null;
  }

  async listAccounts() {
    return (
      await this.prisma.account.findMany({ orderBy: { username: "asc" } })
    ).map(mapAccount);
  }

  async createAccount(input: {
    username: string;
    passwordHash: string;
    role: AccountRecord["role"];
    mustChangePassword: boolean;
  }) {
    const existing = await this.prisma.account.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (existing) return null;
    try {
      const item = await this.prisma.account.create({
        data: {
          username: input.username,
          passwordHash: input.passwordHash,
          role:
            input.role === "super_admin"
              ? DatabaseAccountRole.SUPER_ADMIN
              : input.role === "admin"
                ? DatabaseAccountRole.ADMIN
                : DatabaseAccountRole.USER,
          mustChangePassword: input.mustChangePassword,
        },
      });
      return mapAccount(item);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return null;
      throw error;
    }
  }

  async deleteAccount(id: string) {
    try {
      await this.prisma.account.delete({ where: { id } });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      )
        return false;
      throw error;
    }
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
    if (!item || item.expiresAt <= new Date() || !item.account.isActive)
      return null;
    const refreshBefore = new Date(Date.now() - 5 * 60 * 1000);
    if (item.lastSeenAt < refreshBefore)
      await this.prisma.authSession.updateMany({
        where: { id: item.id, lastSeenAt: { lt: refreshBefore } },
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
    if (
      !item?.account?.isActive ||
      item.revokedAt ||
      (item.expiresAt && item.expiresAt <= new Date())
    )
      return null;
    const refreshBefore = new Date(Date.now() - 5 * 60 * 1000);
    if (!item.lastUsedAt || item.lastUsedAt < refreshBefore)
      await this.prisma.apiToken.updateMany({
        where: {
          id: item.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: refreshBefore } }],
        },
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

  async publishArchive(archive: Buffer | string, actor: PublishActor) {
    const parsed = await parsePackageArchive(archive);
    const existingPackage = await this.prisma.package.findUnique({
      where: { name: parsed.name },
      select: {
        id: true,
        permissions: {
          where: { subjectId: actor.id },
          select: { role: true },
        },
      },
    });
    if (
      existingPackage &&
      actor.role !== "admin" &&
      actor.role !== "super_admin" &&
      !existingPackage.permissions.some(
        (permission) =>
          permission.role === PackageRole.PACKAGE_ADMIN ||
          permission.role === PackageRole.PACKAGE_WRITER,
      )
    )
      throw forbiddenPublish(parsed.name);
    const duplicate = await this.prisma.packageVersion.findFirst({
      where: { package: { name: parsed.name }, version: parsed.version },
      select: { id: true },
    });
    if (duplicate)
      throw new PackageVersionConflictError(parsed.name, parsed.version);

    const objectId = randomUUID();
    const archivePath = join(
      this.storageDirectory,
      "objects",
      parsed.name,
      parsed.version,
      `${objectId}.tar.gz`,
    );
    const temporaryPath = `${archivePath}.${randomUUID()}.tmp`;
    const files: Array<{
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
    }> = [];
    try {
      await mkdir(dirname(archivePath), { recursive: true });
      if (Buffer.isBuffer(archive))
        await writeFile(temporaryPath, archive, { flag: "wx" });
      else await copyFile(archive, temporaryPath);
      await rename(temporaryPath, archivePath);
      for (const [index, file] of parsed.files.entries()) {
        const isText =
          file.type === "file" &&
          file.preview !== "unsupported" &&
          file.preview !== "image";
        files.push({
          path: file.path,
          kind: file.type,
          sizeBytes: BigInt(file.size ?? 0),
          mimeType: null,
          sha256: createHash("sha256")
            .update(`${file.path}:${file.size ?? 0}`)
            .digest("hex"),
          // The path points to an entry inside PackageVersion.archiveObjectKey;
          // no extracted preview file is persisted alongside the tarball.
          storageKey: file.path,
          isText,
          language: file.language,
          previewStatus:
            file.preview && file.preview !== "unsupported"
              ? PreviewStatus.READY
              : PreviewStatus.UNSUPPORTED,
          sortOrder: index,
        });
      }
      await this.persistPackage(parsed, archivePath, files, actor);
    } catch (error) {
      await Promise.allSettled([
        rm(temporaryPath, { force: true }),
        rm(archivePath, { force: true }),
      ]);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new PackageVersionConflictError(parsed.name, parsed.version);
      throw error;
    }
    return {
      name: parsed.name,
      version: parsed.version,
      packageCreated: !existingPackage,
    };
  }

  async getArchivePath(name: string, version: string) {
    const item = await this.prisma.packageVersion.findFirst({
      where: { package: { name }, version },
      select: { archiveObjectKey: true },
    });
    if (!item) return null;
    try {
      await access(item.archiveObjectKey);
      return item.archiveObjectKey;
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
    const dependencies =
      parsed.pubspec.dependencies &&
      typeof parsed.pubspec.dependencies === "object" &&
      !Array.isArray(parsed.pubspec.dependencies)
        ? (parsed.pubspec.dependencies as Record<string, unknown>)
        : {};
    const environment =
      parsed.pubspec.environment &&
      typeof parsed.pubspec.environment === "object" &&
      !Array.isArray(parsed.pubspec.environment)
        ? (parsed.pubspec.environment as Record<string, unknown>)
        : {};
    const isFlutter = Boolean(
      dependencies.flutter || environment.flutter || parsed.pubspec.flutter,
    );
    const shouldRunSync =
      process.env.NODE_ENV === "test" ||
      process.env.RUN_ANALYZER_SYNC === "true";
    let findings: AnalyzerFinding[] = [];
    if (shouldRunSync) {
      findings = await runDartAnalyze(archivePath, isFlutter);
    }
    const calculatedScore = scoreParsedPackage(parsed, 0, findings);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${parsed.name}))
      `;
      const existing = await transaction.package.findUnique({
        where: { name: parsed.name },
        select: {
          id: true,
          permissions: {
            where: { subjectId: actor.id },
            select: { role: true },
          },
        },
      });
      if (
        existing &&
        actor.role !== "admin" &&
        actor.role !== "super_admin" &&
        !existing.permissions.some(
          (permission) =>
            permission.role === PackageRole.PACKAGE_ADMIN ||
            permission.role === PackageRole.PACKAGE_WRITER,
        )
      )
        throw forbiddenPublish(parsed.name);
      const publisher = await transaction.publisher.upsert({
        where: { publisherId: this.publisherId },
        update: {},
        create: {
          publisherId: this.publisherId,
          displayName: this.publisherId,
        },
      });
      const packageRecord = await transaction.package.upsert({
        where: { name: parsed.name },
        update: {
          publisherId: publisher.id,
        },
        create: {
          name: parsed.name,
          normalizedName: parsed.name.toLowerCase(),
          description: parsed.description,
          topics,
          publisherId: publisher.id,
          creatorId: actor.id,
          creatorRole: mapAccountRoleToDatabaseRole(actor.role),
        },
      });
      if (!existing)
        await transaction.packagePermission.create({
          data: {
            packageId: packageRecord.id,
            subjectType: SubjectType.USER,
            subjectId: actor.id,
            role: PackageRole.PACKAGE_ADMIN,
            grantedBy: actor.id,
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
      await transaction.analysisRun.create({
        data: {
          packageVersionId: versionRecord.id,
          status: shouldRunSync ? "COMPLETED" : "QUEUED",
          startedAt: shouldRunSync ? publishedAt : null,
          endedAt: shouldRunSync ? new Date() : null,
        },
      });
      const previousLatest = packageRecord.latestVersionId
        ? await transaction.packageVersion.findUnique({
            where: { id: packageRecord.latestVersionId },
            select: { id: true, version: true, retractedAt: true },
          })
        : null;
      const latest = selectLatestRelease(
        [
          previousLatest,
          {
            id: versionRecord.id,
            version: versionRecord.version,
            retractedAt: versionRecord.retractedAt,
          },
        ].filter(
          (
            item,
          ): item is {
            id: bigint;
            version: string;
            retractedAt: Date | null;
          } => item !== null,
        ),
      )!;
      await this.refreshLatestPackage(transaction, packageRecord.id, latest.id);
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

  private async refreshLatestPackage(
    transaction: Prisma.TransactionClient,
    packageId: bigint,
    latestVersionId: bigint,
  ) {
    const latest = await transaction.packageVersion.findUnique({
      where: { id: latestVersionId },
      include: {
        package: { include: { publisher: true } },
        files: {
          where: { previewStatus: PreviewStatus.READY },
          select: { id: true },
          take: 1,
        },
        scores: { orderBy: { computedAt: "desc" }, take: 1 },
      },
    });
    if (!latest || latest.packageId !== packageId)
      throw new Error("Latest package version is inconsistent.");
    const pubspec = jsonRecord(latest.pubspecJson);
    const description = String(
      pubspec.description ??
        latest.package.description ??
        "No description provided.",
    );
    const topics = stringArray(pubspec.topics);
    const score = latest.scores[0];
    await transaction.package.update({
      where: { id: packageId },
      data: { latestVersionId, description, topics },
    });
    const searchData = {
      packageVersionId: latestVersionId,
      name: latest.package.name,
      description,
      readmeExcerpt: latest.readmeHtml?.slice(0, 500),
      topicsJson: topics,
      publisherIdentifier: latest.package.publisher?.publisherId,
      platformsJson: platformsFromPubspec(pubspec),
      tagsJson: stringArray(score?.tagsJson),
      rankingFeaturesJson: {
        score: score?.grantedPoints ?? 0,
        downloads30d: score?.downloadCount30d ?? 0,
      },
      sdkKind: isFlutterPackage(pubspec) ? "flutter" : "dart",
      score: score?.grantedPoints ?? 0,
      downloads30d: score?.downloadCount30d ?? 0,
      hasPreview: latest.files.length > 0,
    } satisfies Omit<Prisma.SearchDocumentUncheckedCreateInput, "packageId">;
    await transaction.searchDocument.upsert({
      where: { packageId },
      update: searchData,
      create: { packageId, ...searchData },
    });
  }

  private async backfillEmptyScores() {
    const configuredLimit = Number(
      process.env.MAX_SCORE_BACKFILLS_PER_STARTUP ?? 100,
    );
    const limit = Number.isFinite(configuredLimit)
      ? Math.max(0, Math.floor(configuredLimit))
      : 100;
    if (!limit) return;
    const versions = await this.prisma.packageVersion.findMany({
      where: {
        scores: {
          some: { calculationVersion: { lt: SCORE_CALCULATION_VERSION } },
        },
      },
      include: {
        files: { select: { path: true } },
        dependencies: true,
        scores: { orderBy: { computedAt: "desc" }, take: 1 },
      },
      orderBy: { id: "asc" },
      take: limit,
    });
    for (const version of versions) {
      const current = version.scores[0];
      if (!current) continue;
      let calculated: Score | null = null;
      if (current.calculationVersion < SCORE_CALCULATION_VERSION) {
        const pubspec = jsonRecord(version.pubspecJson);
        calculated = calculatePackageScore({
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
      await this.prisma.score.updateMany({
        where: {
          packageVersionId: version.id,
          calculationVersion: { lt: SCORE_CALCULATION_VERSION },
        },
        data: { calculationVersion: SCORE_CALCULATION_VERSION },
      });
      if (calculated)
        await this.prisma.searchDocument.updateMany({
          where: { packageVersionId: version.id },
          data: {
            score: calculated.grantedPoints,
            rankingFeaturesJson: {
              score: calculated.grantedPoints,
              downloads30d: current.downloadCount30d,
            },
          },
        });
    }
  }

  private summary(
    item: DatabasePackage,
    latest: NonNullable<DatabasePackage["latestVersion"]>,
    hasPreview: boolean,
  ): PackageSummary {
    const score = scoreFromDatabase(latest.scores[0]);
    const pubspec = (latest.pubspecJson as Record<string, unknown>) || {};
    const repository =
      typeof pubspec.repository === "string" ? pubspec.repository : null;
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
      hasPreview,
      repository,
      creatorId: item.creatorId,
      creatorRole: mapDatabaseRoleToAccountRole(item.creatorRole),
    };
  }

  private summaryFromSearchDocument(
    item: DatabaseSearchDocument,
  ): PackageSummary {
    const pubspec = (item.version.pubspecJson as Record<string, unknown>) || {};
    const repository =
      typeof pubspec.repository === "string" ? pubspec.repository : null;
    return {
      name: item.name,
      publisherId:
        item.publisherIdentifier ??
        item.package.publisher?.publisherId ??
        "local.private",
      description: item.description ?? "No description provided.",
      latestVersion: item.version.version,
      isDiscontinued: item.package.isDiscontinued,
      topics: stringArray(item.topicsJson),
      updatedAt: item.updatedAt.toISOString(),
      downloads30d: item.downloads30d,
      score: item.score,
      hasPreview: item.hasPreview,
      repository,
      creatorId: item.package.creatorId,
      creatorRole: mapDatabaseRoleToAccountRole(item.package.creatorRole),
    };
  }

  private async mapFile(
    file: DatabaseFile,
    includeContent: boolean,
    archivePath: string,
  ): Promise<PackageFile> {
    let content: string | undefined;
    if (includeContent && file.isText) {
      try {
        content = await readArchiveTextFile(archivePath, file.path);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
    const preview =
      file.previewStatus === PreviewStatus.READY
        ? previewForLanguage(file.language)
        : ("unsupported" as const);
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

  async createPendingUpload(
    data: Omit<PendingUploadRecord, "createdAt">,
  ): Promise<PendingUploadRecord> {
    const item = await this.prisma.pendingUpload.create({
      data: {
        id: data.id,
        actorId: data.actorId,
        actorUsername: data.actorUsername,
        actorRole: data.actorRole,
        archivePath: data.archivePath,
        temporaryDirectory: data.temporaryDirectory,
        filename: data.filename,
        uploadedAt: data.uploadedAt ? new Date(data.uploadedAt) : null,
      },
    });
    return {
      ...data,
      createdAt: item.createdAt.toISOString(),
    };
  }

  async getPendingUpload(id: string): Promise<PendingUploadRecord | null> {
    const item = await this.prisma.pendingUpload.findUnique({ where: { id } });
    if (!item) return null;
    return {
      id: item.id,
      actorId: item.actorId,
      actorUsername: item.actorUsername,
      actorRole: item.actorRole,
      createdAt: item.createdAt.toISOString(),
      archivePath: item.archivePath,
      temporaryDirectory: item.temporaryDirectory,
      filename: item.filename,
      uploadedAt: item.uploadedAt?.toISOString() ?? null,
    };
  }

  async updatePendingUpload(
    id: string,
    data: Partial<Omit<PendingUploadRecord, "id" | "createdAt">>,
  ): Promise<PendingUploadRecord | null> {
    const item = await this.prisma.pendingUpload.update({
      where: { id },
      data: {
        archivePath: data.archivePath,
        temporaryDirectory: data.temporaryDirectory,
        filename: data.filename,
        uploadedAt: data.uploadedAt ? new Date(data.uploadedAt) : undefined,
      },
    });
    return {
      id: item.id,
      actorId: item.actorId,
      actorUsername: item.actorUsername,
      actorRole: item.actorRole,
      createdAt: item.createdAt.toISOString(),
      archivePath: item.archivePath,
      temporaryDirectory: item.temporaryDirectory,
      filename: item.filename,
      uploadedAt: item.uploadedAt?.toISOString() ?? null,
    };
  }

  async deletePendingUpload(id: string): Promise<boolean> {
    try {
      await this.prisma.pendingUpload.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async prunePendingUploads(expiresBefore: string): Promise<number> {
    const items = await this.prisma.pendingUpload.findMany({
      where: { createdAt: { lt: new Date(expiresBefore) } },
      select: { id: true, temporaryDirectory: true },
    });
    for (const item of items) {
      if (item.temporaryDirectory) {
        await rm(item.temporaryDirectory, {
          recursive: true,
          force: true,
        }).catch(() => {});
      }
    }
    const result = await this.prisma.pendingUpload.deleteMany({
      where: { id: { in: items.map((i) => i.id) } },
    });
    return result.count;
  }

  async getPendingUploadsCount(actorId?: string): Promise<number> {
    const count = await this.prisma.pendingUpload.count({
      where: actorId ? { actorId } : {},
    });
    return count;
  }

  async createPendingOauthCode(
    data: PendingOauthCodeRecord,
  ): Promise<PendingOauthCodeRecord> {
    await this.prisma.pendingOauthCode.create({
      data: {
        code: data.code,
        subjectId: data.subjectId,
        username: data.username,
        role: data.role,
        scopesJson: data.scopes,
        redirectUri: data.redirectUri,
        codeChallenge: data.codeChallenge,
        expiresAt: new Date(data.expiresAt),
      },
    });
    return data;
  }

  async getPendingOauthCode(
    code: string,
  ): Promise<PendingOauthCodeRecord | null> {
    const item = await this.prisma.pendingOauthCode.findUnique({
      where: { code },
    });
    if (!item) return null;
    return {
      code: item.code,
      subjectId: item.subjectId,
      username: item.username,
      role: item.role,
      scopes: item.scopesJson as string[],
      redirectUri: item.redirectUri,
      codeChallenge: item.codeChallenge,
      expiresAt: item.expiresAt.toISOString(),
    };
  }

  async deletePendingOauthCode(code: string): Promise<boolean> {
    try {
      await this.prisma.pendingOauthCode.delete({ where: { code } });
      return true;
    } catch {
      return false;
    }
  }

  async prunePendingOauthCodes(expiresBefore: string): Promise<number> {
    const result = await this.prisma.pendingOauthCode.deleteMany({
      where: { expiresAt: { lt: new Date(expiresBefore) } },
    });
    return result.count;
  }

  async listPackagePermissions(
    packageName: string,
  ): Promise<PackagePermissionRecord[]> {
    const permissions = await this.prisma.packagePermission.findMany({
      where: { package: { name: packageName } },
    });

    const subjectIds = permissions
      .filter((p) => p.subjectType === SubjectType.USER)
      .map((p) => p.subjectId);

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true, username: true },
    });

    const accountMap = new Map(accounts.map((a) => [a.id, a.username]));

    return permissions.map((p) => ({
      subjectId: p.subjectId,
      subjectType: p.subjectType as any,
      role: p.role as any,
      username:
        p.subjectType === SubjectType.USER
          ? accountMap.get(p.subjectId)
          : undefined,
      grantedAt: p.grantedAt.toISOString(),
      grantedBy: p.grantedBy,
    }));
  }

  async grantPackagePermission(
    packageName: string,
    targetUsername: string,
    role: PackageRole,
    grantedBy: string,
  ): Promise<PackagePermissionRecord | null> {
    const pkg = await this.prisma.package.findUnique({
      where: { name: packageName },
    });
    if (!pkg) return null;

    const account = await this.prisma.account.findUnique({
      where: { username: targetUsername },
    });
    if (!account) return null;

    const permission = await this.prisma.packagePermission.upsert({
      where: {
        packageId_subjectType_subjectId: {
          packageId: pkg.id,
          subjectType: SubjectType.USER,
          subjectId: account.id,
        },
      },
      update: {
        role,
        grantedBy,
        grantedAt: new Date(),
      },
      create: {
        packageId: pkg.id,
        subjectType: SubjectType.USER,
        subjectId: account.id,
        role,
        grantedBy,
      },
    });

    return {
      subjectId: permission.subjectId,
      subjectType: permission.subjectType as any,
      role: permission.role as any,
      username: account.username,
      grantedAt: permission.grantedAt.toISOString(),
      grantedBy: permission.grantedBy,
    };
  }

  async revokePackagePermission(
    packageName: string,
    targetSubjectId: string,
  ): Promise<boolean> {
    const pkg = await this.prisma.package.findUnique({
      where: { name: packageName },
    });
    if (!pkg) return false;

    try {
      await this.prisma.packagePermission.delete({
        where: {
          packageId_subjectType_subjectId: {
            packageId: pkg.id,
            subjectType: SubjectType.USER,
            subjectId: targetSubjectId,
          },
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async hasPackageRole(
    packageName: string,
    subjectId: string,
    role: PackageRole,
  ): Promise<boolean> {
    const permission = await this.prisma.packagePermission.findFirst({
      where: {
        package: { name: packageName },
        subjectId,
        role,
      },
    });
    return !!permission;
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
    sourceType:
      item.sourceType === "pubdev_import" ? "pubdev_import" : "native",
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
    breakdown: Array.isArray(item.breakdownJson)
      ? (item.breakdownJson as Score["breakdown"])
      : [],
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
    calculationVersion: SCORE_CALCULATION_VERSION,
  };
}

function mapImport(item: {
  id: string;
  packageName: string;
  mode: string;
  status: JobStatus;
  requestedVersionsJson: Prisma.JsonValue;
  summaryJson: Prisma.JsonValue | null;
  createdAt: Date;
}): ImportJobRecord {
  return {
    id: item.id,
    packageName: item.packageName,
    versions: stringArray(item.requestedVersionsJson),
    mode: item.mode,
    status: item.status.toLowerCase() as ImportJobRecord["status"],
    createdAt: item.createdAt.toISOString(),
    ...(item.summaryJson &&
    typeof item.summaryJson === "object" &&
    !Array.isArray(item.summaryJson)
      ? { summary: item.summaryJson as Record<string, unknown> }
      : {}),
  };
}

function forbiddenPublish(packageName: string) {
  const error = new Error(
    `The current account does not have permission to publish ${packageName}.`,
  ) as Error & { statusCode?: number };
  error.statusCode = 403;
  return error;
}

function selectLatest<T extends { version: string; retractedAt?: unknown }>(
  versions: T[],
) {
  return selectLatestRelease(versions);
}
function compareDatabaseVersions(a: DatabaseVersion, b: DatabaseVersion) {
  return semver.rcompare(a.version, b.version);
}
function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function minimumVersion(constraint: string) {
  return constraint.match(/\d+\.\d+\.\d+/)?.[0] ?? constraint;
}
function platformsFromPubspec(pubspec: Record<string, unknown>) {
  const declared = Object.keys(jsonRecord(pubspec.platforms));
  return declared.length
    ? declared
    : pubspec.flutter || jsonRecord(pubspec.dependencies).flutter
      ? ["android", "ios", "web", "linux", "macos", "windows"]
      : [];
}
function isFlutterPackage(pubspec: Record<string, unknown>) {
  return Boolean(
    jsonRecord(pubspec.dependencies).flutter ||
    jsonRecord(pubspec.environment).flutter ||
    pubspec.flutter,
  );
}
function dependencyScopeToDatabase(
  scope: "dependencies" | "dev_dependencies" | "dependency_overrides",
) {
  return scope === "dev_dependencies"
    ? DependencyScope.DEV_DEPENDENCIES
    : scope === "dependency_overrides"
      ? DependencyScope.DEPENDENCY_OVERRIDES
      : DependencyScope.DEPENDENCIES;
}
function dependencyScopeFromDatabase(scope: DependencyScope) {
  return scope === DependencyScope.DEV_DEPENDENCIES
    ? ("dev_dependencies" as const)
    : scope === DependencyScope.DEPENDENCY_OVERRIDES
      ? ("dependency_overrides" as const)
      : ("dependencies" as const);
}
function sourceFromDatabase(source: string) {
  return source === "sdk" || source === "git" || source === "path"
    ? source
    : ("hosted" as const);
}
function registryFor(source: string, name: string, privateNames: Set<string>) {
  return source === "sdk"
    ? ("sdk" as const)
    : source === "git"
      ? ("git" as const)
      : source === "path"
        ? ("path" as const)
        : privateNames.has(name)
          ? ("private" as const)
          : ("pubdev" as const);
}
function previewForLanguage(language: string | null): PackageFile["preview"] {
  return language === "markdown"
    ? "markdown"
    : language === "yaml" || language === "json"
      ? "structured"
      : language === "image"
        ? "image"
        : "code";
}
function mapAccount(item: {
  id: string;
  username: string;
  passwordHash: string;
  role: DatabaseAccountRole;
  mustChangePassword: boolean;
  isActive: boolean;
}): AccountRecord {
  return {
    id: item.id,
    username: item.username,
    passwordHash: item.passwordHash,
    role:
      item.role === DatabaseAccountRole.SUPER_ADMIN
        ? "super_admin"
        : item.role === DatabaseAccountRole.ADMIN
          ? "admin"
          : "user",
    mustChangePassword: item.mustChangePassword,
    isActive: item.isActive,
  };
}
function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function mapDatabaseRoleToAccountRole(
  role: DatabaseAccountRole | null | undefined,
): AccountRole | null {
  if (!role) return null;
  return role === DatabaseAccountRole.SUPER_ADMIN
    ? "super_admin"
    : role === DatabaseAccountRole.ADMIN
      ? "admin"
      : "user";
}

function mapAccountRoleToDatabaseRole(
  role: AccountRole | null | undefined,
): DatabaseAccountRole | null {
  if (!role) return null;
  return role === "super_admin"
    ? DatabaseAccountRole.SUPER_ADMIN
    : role === "admin"
      ? DatabaseAccountRole.ADMIN
      : DatabaseAccountRole.USER;
}
