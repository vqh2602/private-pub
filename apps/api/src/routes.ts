import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  createAccountSchema,
  importRequestSchema,
  searchQuerySchema,
  tokenRequestSchema,
} from "@private-pub/contracts";
import { z } from "zod";
import type { PackageVersion } from "@private-pub/contracts";
import type { PublishActor, RegistryRepository } from "./domain.js";
import {
  hashSecret,
  issueToken,
  newSession,
  requireScopes,
  sessionCookieName,
} from "./security.js";
import { hashPassword, verifyPassword } from "./password.js";

const nameParams = z.object({ name: z.string() });
const versionParams = nameParams.extend({ version: z.string() });
const queryBoolean = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean(),
);
const packageDetailQuery = z.object({
  includeVersions: queryBoolean.default(true),
  includeFiles: queryBoolean.default(true),
});
const hostedContentType = "application/vnd.pub.v2+json; charset=utf-8";
const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(256),
});
const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(10).max(256),
});

function sessionCookieOptions(expiresAt?: string) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true",
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  };
}

function hostedVersion(
  request: FastifyRequest,
  name: string,
  item: PackageVersion,
) {
  return {
    version: item.version,
    pubspec: item.pubspec,
    archive_url: `${request.protocol}://${request.host}/api/packages/${name}/versions/${item.version}.tar.gz`,
    archive_sha256: item.archiveSha256,
    published: item.publishedAt,
    retracted: Boolean(item.retractedAt),
  };
}

export async function registerRoutes(
  app: FastifyInstance,
  repository: RegistryRepository,
) {
  const pendingUploads = new Map<
    string,
    {
      actor: PublishActor;
      archive?: Buffer;
      filename?: string;
      uploadedAt?: string;
    }
  >();
  const scopes = (...required: Parameters<typeof requireScopes>[1][]) =>
    requireScopes(repository, ...required);
  app.get("/health", async () => ({
    status: "ok",
    mode: repository.mode,
    timestamp: new Date().toISOString(),
  }));

  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const account = await repository.findAccountByUsername(input.username);
      if (
        !account?.isActive ||
        !(await verifyPassword(input.password, account.passwordHash))
      )
        return reply.code(401).send({
          error: "invalid_credentials",
          message: "Username or password is incorrect.",
        });
      const session = newSession();
      await repository.createSession(
        account.id,
        session.tokenHash,
        session.expiresAt,
      );
      return reply
        .setCookie(
          sessionCookieName,
          session.plaintext,
          sessionCookieOptions(session.expiresAt),
        )
        .send({
          user: {
            id: account.id,
            username: account.username,
            role: account.role,
            mustChangePassword: account.mustChangePassword,
          },
        });
    },
  );
  app.get(
    "/v1/auth/me",
    { preHandler: scopes("packages:read") },
    async (request) => ({
      user: {
        id: request.actor!.id,
        username: request.actor!.username,
        role: request.actor!.role,
        mustChangePassword: request.actor!.mustChangePassword,
      },
    }),
  );
  app.post("/v1/auth/logout", async (request, reply) => {
    const session = request.cookies[sessionCookieName];
    if (session) await repository.revokeSession(hashSecret(session));
    return reply
      .clearCookie(sessionCookieName, sessionCookieOptions())
      .code(204)
      .send();
  });
  app.patch(
    "/v1/auth/password",
    { preHandler: scopes("packages:read") },
    async (request, reply) => {
      if (request.actor!.authType !== "session" || !request.actor!.username)
        return reply.code(403).send({
          error: "session_required",
          message: "Sign in with your account to change the password.",
        });
      const input = passwordSchema.parse(request.body);
      const account = await repository.findAccountByUsername(
        request.actor!.username,
      );
      if (
        !account ||
        !(await verifyPassword(input.currentPassword, account.passwordHash))
      )
        return reply.code(400).send({
          error: "invalid_current_password",
          message: "Current password is incorrect.",
        });
      await repository.updatePassword(
        account.id,
        await hashPassword(input.newPassword),
      );
      return reply
        .clearCookie(sessionCookieName, sessionCookieOptions())
        .code(204)
        .send();
    },
  );

  app.get(
    "/v1/admin/accounts",
    { preHandler: scopes("packages:admin") },
    async (request, reply) => {
      if (
        request.actor!.role !== "admin" &&
        request.actor!.role !== "super_admin"
      )
        return reply.code(403).send({ error: "admin_required" });
      const accounts = await repository.listAccounts();
      return {
        items: accounts.map(
          ({ passwordHash: _passwordHash, ...account }) => account,
        ),
      };
    },
  );

  app.post(
    "/v1/admin/accounts",
    { preHandler: scopes("packages:admin") },
    async (request, reply) => {
      if (
        request.actor!.role !== "admin" &&
        request.actor!.role !== "super_admin"
      )
        return reply.code(403).send({ error: "admin_required" });
      const input = createAccountSchema.parse(request.body);
      if (request.actor!.role !== "super_admin" && input.role !== "user") {
        return reply.code(403).send({
          error: "forbidden_role",
          message:
            "Only a super administrator can create administrator accounts.",
        });
      }
      const account = await repository.createAccount({
        username: input.username,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        mustChangePassword: true,
      });
      if (!account)
        return reply.code(409).send({
          error: "username_exists",
          message: "Username already exists.",
        });
      const { passwordHash: _passwordHash, ...safeAccount } = account;
      return reply.code(201).send({ user: safeAccount });
    },
  );

  // Hosted Pub Repository API V2 read surface.
  app.get("/api/packages/:name", async (request, reply) => {
    const { name } = nameParams.parse(request.params);
    const metadata = await repository.getPackageMetadata(name);
    if (!metadata)
      return reply
        .code(404)
        .type(hostedContentType)
        .send({
          error: {
            code: "not_found",
            message: `Package ${name} was not found.`,
          },
        });
    const versions = metadata.versions.map((item) =>
      hostedVersion(request, name, item),
    );
    const latest =
      versions.find(
        (item) => item.version === metadata.latestVersion.version,
      ) ?? versions[0];
    return reply.type(hostedContentType).send({
      name,
      latest,
      versions,
      ...(metadata.isDiscontinued ? { isDiscontinued: true } : {}),
    });
  });

  app.get("/api/packages/:name/versions/:version", async (request, reply) => {
    const { name, version } = versionParams.parse(request.params);
    const item = await repository.getVersion(name, version);
    if (!item)
      return reply
        .code(404)
        .type(hostedContentType)
        .send({
          error: {
            code: "not_found",
            message: "Package version was not found.",
          },
        });
    return reply
      .type(hostedContentType)
      .send(hostedVersion(request, name, item));
  });

  app.get(
    "/api/packages/:name/versions/:version.tar.gz",
    async (request, reply) => {
      const { name, version } = versionParams.parse(request.params);
      if (!(await repository.getVersion(name, version)))
        return reply.code(404).send({
          error: { code: "not_found", message: "Archive was not found." },
        });
      const archive = await repository.getArchive(name, version);
      if (archive)
        return reply
          .type("application/octet-stream")
          .header(
            "Content-Disposition",
            `attachment; filename="${name}-${version}.tar.gz"`,
          )
          .send(archive);
      return reply.code(501).send({
        error: {
          code: "archive_adapter_required",
          message:
            "Configure S3ArchiveStore for binary archives. Metadata and publish flow are available in demo mode.",
        },
      });
    },
  );

  const startUpload = async (request: FastifyRequest, reply: FastifyReply) => {
    const uploadId = randomUUID();
    pendingUploads.set(uploadId, {
      actor: { id: request.actor!.id, username: request.actor!.username },
    });
    return reply.type(hostedContentType).send({
      url: `${request.protocol}://${request.host}/api/uploads/${uploadId}`,
      fields: { uploadId },
    });
  };
  app.get(
    "/api/packages/versions/new",
    { preHandler: scopes("packages:publish") },
    startUpload,
  );
  // Compatibility alias for early clients of this scaffold. `dart pub` uses `/new`.
  app.get(
    "/api/packages/versions/newUpload",
    { preHandler: scopes("packages:publish") },
    startUpload,
  );

  app.post(
    "/api/uploads/:uploadId",
    { preHandler: scopes("packages:publish") },
    async (request, reply) => {
      const { uploadId } = request.params as { uploadId: string };
      const pending = pendingUploads.get(uploadId);
      if (!pending)
        return reply
          .code(404)
          .type(hostedContentType)
          .send({
            error: {
              code: "upload_not_found",
              message: "The upload session is missing or expired.",
            },
          });
      if (pending.actor.id !== request.actor!.id)
        return reply
          .code(403)
          .type(hostedContentType)
          .send({
            error: {
              code: "upload_owner_mismatch",
              message: "This upload session belongs to another account.",
            },
          });
      const file = await request.file();
      if (!file)
        return reply
          .code(400)
          .type(hostedContentType)
          .send({
            error: {
              code: "archive_missing",
              message:
                "Expected multipart field 'file' containing a .tar.gz archive.",
            },
          });
      pending.archive = await file.toBuffer();
      pending.filename = file.filename;
      pending.uploadedAt = new Date().toISOString();
      const finalizeUrl = `${request.protocol}://${request.host}/api/packages/versions/newUploadFinish?uploadId=${uploadId}`;
      return reply.header("Location", finalizeUrl).code(204).send();
    },
  );

  app.get(
    "/api/packages/versions/newUploadFinish",
    { preHandler: scopes("packages:publish") },
    async (request, reply) => {
      const uploadId = String(
        (request.query as { uploadId?: string }).uploadId ?? "",
      );
      const pending = pendingUploads.get(uploadId);
      if (!pending?.archive)
        return reply
          .code(400)
          .type(hostedContentType)
          .send({
            error: {
              code: "upload_incomplete",
              message:
                "No uploaded archive was found for this publish session.",
            },
          });
      if (pending.actor.id !== request.actor!.id)
        return reply
          .code(403)
          .type(hostedContentType)
          .send({
            error: {
              code: "upload_owner_mismatch",
              message: "This upload session belongs to another account.",
            },
          });
      try {
        const published = await repository.publishArchive(
          pending.archive,
          pending.actor,
        );
        pendingUploads.delete(uploadId);
        return reply.type(hostedContentType).send({
          success: {
            message: `Published ${published.name} ${published.version} successfully; analysis has been queued.`,
          },
        });
      } catch (error) {
        pendingUploads.delete(uploadId);
        const message =
          error instanceof Error
            ? error.message
            : "The uploaded archive could not be published.";
        request.log.warn(
          { uploadId, error: message },
          "Package finalization rejected the uploaded archive",
        );
        return reply
          .code(400)
          .type(hostedContentType)
          .send({ error: { code: "invalid_archive", message } });
      }
    },
  );

  // Private control-plane API.
  app.get("/v1/stats", async () => repository.getStats());

  app.get("/v1/search", async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const result = await repository.search(query.q, query);
    return {
      items: result.items,
      total: result.total,
      page: query.page,
      limit: query.limit,
    };
  });

  app.get(
    "/v1/packages/mine",
    { preHandler: scopes("packages:read") },
    async (request) => {
      const identities = new Set(
        [request.actor!.id, request.actor!.username].filter(
          (value): value is string => Boolean(value),
        ),
      );
      return {
        items: await repository.listPublishedPackages([...identities]),
      };
    },
  );

  app.get("/v1/packages/:name", async (request, reply) => {
    const { name } = nameParams.parse(request.params);
    const options = packageDetailQuery.parse(request.query);
    const detail = await repository.getPackage(name, options);
    return (
      detail ??
      reply
        .code(404)
        .send({ error: "not_found", message: `Package ${name} was not found.` })
    );
  });
  app.get("/v1/packages/:name/versions/:version", async (request, reply) => {
    const { name, version } = versionParams.parse(request.params);
    return (
      (await repository.getVersion(name, version)) ??
      reply.code(404).send({ error: "not_found" })
    );
  });
  app.get(
    "/v1/packages/:name/versions/:version/files",
    async (request, reply) => {
      const { name, version } = versionParams.parse(request.params);
      return {
        package: name,
        version,
        entries:
          (await repository.getFiles(name, version)) ??
          reply.code(404).send({ error: "not_found" }),
      };
    },
  );
  app.get(
    "/v1/packages/:name/versions/:version/files/*",
    async (request, reply) => {
      const params = request.params as {
        name: string;
        version: string;
        "*": string;
      };
      return (
        (await repository.getFile(params.name, params.version, params["*"])) ??
        reply.code(404).send({ error: "not_found" })
      );
    },
  );
  app.get(
    "/v1/packages/:name/versions/:version/score",
    async (request, reply) => {
      const { name, version } = versionParams.parse(request.params);
      return (
        (await repository.getScore(name, version)) ??
        reply.code(404).send({ error: "not_found" })
      );
    },
  );

  app.post(
    "/v1/imports/pubdev",
    { preHandler: scopes("imports:write") },
    async (request, reply) => {
      const input = importRequestSchema.parse(request.body);
      const job = await repository.createImport({
        packageName: input.packageName,
        versions: input.versions,
        mode: input.mode,
      });
      return reply.code(202).send(job);
    },
  );
  app.post(
    "/v1/imports/file",
    { preHandler: scopes("imports:write") },
    async (request, reply) => {
      const file = await request.file();
      if (!file)
        return reply.code(400).send({
          error: "archive_missing",
          message: "Chọn một file package .tar.gz để import.",
        });
      if (!file.filename.toLowerCase().endsWith(".tar.gz")) {
        file.file.resume();
        return reply.code(400).send({
          error: "invalid_file_type",
          message: "File import phải có định dạng .tar.gz.",
        });
      }
      try {
        const published = await repository.publishArchive(
          await file.toBuffer(),
          { id: request.actor!.id, username: request.actor!.username },
        );
        const action = published.packageCreated
          ? "package_created"
          : "version_added";
        return reply.code(201).send({
          packageName: published.name,
          version: published.version,
          action,
          message: published.packageCreated
            ? `Đã xác minh và tạo package ${published.name} ${published.version}.`
            : `Đã xác minh và thêm version ${published.version} vào package ${published.name}.`,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Không thể xác minh package archive.";
        const statusCode =
          typeof (error as { statusCode?: unknown })?.statusCode === "number"
            ? (error as { statusCode: number }).statusCode
            : undefined;
        if (statusCode === 413)
          return reply.code(413).send({
            error: "archive_too_large",
            message: "File package vượt quá giới hạn upload cho phép.",
          });
        const duplicate = /already exists/i.test(message);
        request.log.warn(
          { filename: file.filename, error: message },
          "File import rejected",
        );
        return reply.code(duplicate ? 409 : 400).send({
          error: duplicate ? "version_exists" : "invalid_archive",
          message,
        });
      }
    },
  );
  app.get("/v1/imports", { preHandler: scopes("packages:read") }, async () => ({
    items: await repository.listImports(),
  }));
  app.get(
    "/v1/imports/:jobId",
    { preHandler: scopes("packages:read") },
    async (request, reply) =>
      (await repository.getImport(
        (request.params as { jobId: string }).jobId,
      )) ?? reply.code(404).send({ error: "not_found" }),
  );
  app.post(
    "/v1/analyses/recompute",
    { preHandler: scopes("packages:admin") },
    async (request, reply) =>
      reply.code(202).send({
        id: `ana_${randomUUID().slice(0, 16)}`,
        status: "queued",
        input: request.body,
      }),
  );

  app.post(
    "/v1/tokens",
    { preHandler: scopes("tokens:write") },
    async (request, reply) => {
      const input = tokenRequestSchema.parse(request.body);
      return reply
        .code(201)
        .send(await issueToken(repository, input, request.actor!.id));
    },
  );
  app.get(
    "/v1/tokens",
    { preHandler: scopes("tokens:write") },
    async (request) => ({
      items: await repository.listTokens(request.actor!.id),
    }),
  );
  app.delete(
    "/v1/tokens/:id",
    { preHandler: scopes("tokens:write") },
    async (request, reply) =>
      (await repository.revokeToken(
        (request.params as { id: string }).id,
        request.actor!.id,
      ))
        ? reply.code(204).send()
        : reply.code(404).send({ error: "not_found" }),
  );

  for (const [suffix, retracted] of [
    ["retract", true],
    ["restore", false],
  ] as const) {
    app.post(
      `/v1/packages/:name/versions/:version/${suffix}`,
      { preHandler: scopes("packages:admin") },
      async (request, reply) => {
        const { name, version } = versionParams.parse(request.params);
        return (
          (await repository.setRetraction(name, version, retracted)) ??
          reply.code(404).send({ error: "not_found" })
        );
      },
    );
  }
  for (const [suffix, discontinued] of [
    ["discontinue", true],
    ["undiscontinue", false],
  ] as const) {
    app.post(
      `/v1/packages/:name/${suffix}`,
      { preHandler: scopes("packages:admin") },
      async (request, reply) => {
        const { name } = nameParams.parse(request.params);
        return (
          (await repository.setDiscontinued(name, discontinued)) ??
          reply.code(404).send({ error: "not_found" })
        );
      },
    );
  }
}
