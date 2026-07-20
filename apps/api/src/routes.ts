import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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
  authenticateRequest,
  allScopes,
  optionalAuthentication,
  requireScopes,
  repositoryActor,
  scopesForRole,
  sessionCookieName,
  type Scope,
} from "./security.js";
import { hashPassword, verifyPassword } from "./password.js";
import { InvalidArchiveError } from "./archive.js";
import { getSystemInfo } from "./system-info.js";

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
const oauthAuthorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.literal("private_pub_cli"),
  redirect_uri: z.string().url().max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().min(8).max(256),
  scope: z.string().max(512).default("packages:read packages:publish"),
});
const oauthLoginSchema = oauthAuthorizeSchema.extend({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(256),
});
const oauthTokenSchema = z.object({
  grant_type: z.literal("authorization_code"),
  client_id: z.literal("private_pub_cli"),
  code: z.string().min(16).max(256),
  redirect_uri: z.string().url().max(2048),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});

interface PendingOAuthCode {
  subjectId: string;
  username?: string;
  role?: "super_admin" | "admin" | "user";
  scopes: Scope[];
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}

function sessionCookieOptions(expiresAt?: string) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true",
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  };
}

function hostedVersion(baseUrl: string, name: string, item: PackageVersion) {
  return {
    version: item.version,
    pubspec: item.pubspec,
    archive_url: `${baseUrl}/api/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(item.version)}.tar.gz`,
    archive_sha256: item.archiveSha256,
    published: item.publishedAt,
    retracted: Boolean(item.retractedAt),
  };
}

export async function registerRoutes(
  app: FastifyInstance,
  repository: RegistryRepository,
) {
  const oauthCodes = new Map<string, PendingOAuthCode>();
  const pendingUploads = new Map<
    string,
    {
      actor: PublishActor;
      createdAt: number;
      archivePath?: string;
      temporaryDirectory?: string;
      filename?: string;
      uploadedAt?: string;
    }
  >();
  const uploadSessionTtlMs = positiveNumber(
    process.env.UPLOAD_SESSION_TTL_MS,
    15 * 60 * 1000,
  );
  const maxPendingUploadSessions = positiveNumber(
    process.env.MAX_PENDING_UPLOAD_SESSIONS,
    20,
  );
  const maxPendingUploadSessionsPerActor = positiveNumber(
    process.env.MAX_PENDING_UPLOAD_SESSIONS_PER_ACTOR,
    Math.min(3, maxPendingUploadSessions),
  );
  const prunePendingUploads = async () => {
    const oldestAllowed = Date.now() - uploadSessionTtlMs;
    for (const [id, upload] of pendingUploads) {
      if (upload.createdAt >= oldestAllowed) continue;
      pendingUploads.delete(id);
      if (upload.temporaryDirectory)
        await rm(upload.temporaryDirectory, { recursive: true, force: true });
    }
  };
  app.addHook("onClose", async () => {
    await Promise.all(
      [...pendingUploads.values()].map((upload) =>
        upload.temporaryDirectory
          ? rm(upload.temporaryDirectory, { recursive: true, force: true })
          : Promise.resolve(),
      ),
    );
    pendingUploads.clear();
    oauthCodes.clear();
  });
  const scopes = (...required: Parameters<typeof requireScopes>[1][]) =>
    requireScopes(repository, ...required);
  const optionalAuth = optionalAuthentication(repository);
  const canReadPackage = async (
    request: FastifyRequest,
    reply: FastifyReply,
    name: string,
  ) => {
    if (await repository.canReadPackage(name, repositoryActor(request.actor)))
      return true;
    reply.code(404).send({ error: "not_found" });
    return false;
  };
  const baseUrl = (request: FastifyRequest) =>
    (
      process.env.PUBLIC_BASE_URL ?? `${request.protocol}://${request.host}`
    ).replace(/\/$/, "");
  const dummyPasswordHash = await hashPassword(randomUUID());
  app.get("/health", async () => ({
    status: "ok",
    mode: repository.mode,
    timestamp: new Date().toISOString(),
  }));
  app.get("/v1/system/info", async () => getSystemInfo());

  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const account = await repository.findAccountByUsername(input.username);
      const passwordMatches = await verifyPassword(
        input.password,
        account?.passwordHash ?? dummyPasswordHash,
      );
      if (!account?.isActive || !passwordMatches)
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

  const oauthScopes = (raw: string) => {
    const values = [...new Set(raw.split(/\s+/).filter(Boolean))];
    if (
      !values.length ||
      !values.every((value) => allScopes.includes(value as Scope))
    ) {
      const error = new Error(
        "OAuth request contains an unsupported scope.",
      ) as Error & {
        statusCode?: number;
      };
      error.statusCode = 400;
      throw error;
    }
    return values as Scope[];
  };
  const oauthInput = (raw: unknown) => {
    const input = oauthAuthorizeSchema.parse(raw);
    validateLoopbackRedirect(input.redirect_uri);
    return { ...input, scopes: oauthScopes(input.scope) };
  };
  const authorize = (
    input: ReturnType<typeof oauthInput>,
    actor: {
      id: string;
      username?: string;
      role?: "super_admin" | "admin" | "user";
      scopes: Scope[];
      mustChangePassword?: boolean;
    },
  ) => {
    if (
      actor.mustChangePassword &&
      input.scopes.some((scope) => scope !== "packages:read")
    ) {
      const error = new Error(
        "Change the default password before authorizing CLI publishing.",
      ) as Error & {
        statusCode?: number;
      };
      error.statusCode = 403;
      throw error;
    }
    if (!input.scopes.every((scope) => actor.scopes.includes(scope))) {
      const error = new Error(
        "The account cannot grant all requested OAuth scopes.",
      ) as Error & {
        statusCode?: number;
      };
      error.statusCode = 403;
      throw error;
    }
    for (const [code, pending] of oauthCodes) {
      if (pending.expiresAt <= Date.now()) oauthCodes.delete(code);
    }
    const code = randomBytes(32).toString("base64url");
    oauthCodes.set(code, {
      subjectId: actor.id,
      username: actor.username,
      role: actor.role,
      scopes: input.scopes,
      redirectUri: input.redirect_uri,
      codeChallenge: input.code_challenge,
      expiresAt: Date.now() + 5 * 60_000,
    });
    const redirect = new URL(input.redirect_uri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", input.state);
    return redirect.toString();
  };

  app.get("/oauth/authorize", async (request, reply) => {
    const input = oauthInput(request.query);
    const actor = await authenticateRequest(repository, request);
    if (actor && actor.authType !== "token") {
      return reply
        .header("cache-control", "no-store")
        .redirect(authorize(input, actor));
    }
    return reply
      .header("cache-control", "no-store")
      .type("text/html; charset=utf-8")
      .send(oauthLoginPage(input));
  });

  app.post(
    "/oauth/authorize",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const credentials = oauthLoginSchema.parse(request.body);
      const input = oauthInput(credentials);
      const account = await repository.findAccountByUsername(
        credentials.username,
      );
      const matches = await verifyPassword(
        credentials.password,
        account?.passwordHash ?? dummyPasswordHash,
      );
      if (!account?.isActive || !matches) {
        return reply
          .code(401)
          .header("cache-control", "no-store")
          .type("text/html; charset=utf-8")
          .send(oauthLoginPage(input, "Username or password is incorrect."));
      }
      return reply.header("cache-control", "no-store").redirect(
        authorize(input, {
          id: account.id,
          username: account.username,
          role: account.role,
          scopes: scopesForRole(account.role),
          mustChangePassword: account.mustChangePassword,
        }),
      );
    },
  );

  app.post("/oauth/token", async (request, reply) => {
    const input = oauthTokenSchema.parse(request.body);
    const pending = oauthCodes.get(input.code);
    oauthCodes.delete(input.code);
    if (
      !pending ||
      pending.expiresAt <= Date.now() ||
      pending.redirectUri !== input.redirect_uri
    ) {
      return reply.code(400).send({
        error: "invalid_grant",
        error_description: "Authorization code is invalid or expired.",
      });
    }
    const challenge = createHash("sha256")
      .update(input.code_verifier, "ascii")
      .digest("base64url");
    if (challenge !== pending.codeChallenge) {
      return reply.code(400).send({
        error: "invalid_grant",
        error_description: "PKCE verification failed.",
      });
    }
    const issued = await issueToken(
      repository,
      {
        name: "Private Pub CLI OAuth",
        scopes: pending.scopes,
        expiresInDays: 90,
      },
      pending.subjectId,
      pending.scopes,
    );
    return reply.header("cache-control", "no-store").send({
      access_token: issued.token,
      token_type: "Bearer",
      expires_in: 90 * 86_400,
      scope: issued.scopes.join(" "),
      username: pending.username,
    });
  });
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
        request.actor!.authType === "token" ||
        (request.actor!.role !== "admin" &&
          request.actor!.role !== "super_admin")
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
        request.actor!.authType === "token" ||
        (request.actor!.role !== "admin" &&
          request.actor!.role !== "super_admin")
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
  app.get(
    "/api/packages/:name",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const { name } = nameParams.parse(request.params);
      if (!(await canReadPackage(request, reply, name))) return;
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
        hostedVersion(baseUrl(request), name, item),
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
    },
  );

  app.get(
    "/api/packages/:name/versions/:version",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const { name, version } = versionParams.parse(request.params);
      if (!(await canReadPackage(request, reply, name))) return;
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
        .send(hostedVersion(baseUrl(request), name, item));
    },
  );

  app.get(
    "/api/packages/:name/versions/:version.tar.gz",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const { name, version } = versionParams.parse(request.params);
      if (!(await canReadPackage(request, reply, name))) return;
      if (!(await repository.getVersion(name, version)))
        return reply.code(404).send({
          error: { code: "not_found", message: "Archive was not found." },
        });
      const archivePath = await repository.getArchivePath(name, version);
      if (archivePath)
        return reply
          .type("application/gzip")
          .header(
            "Content-Disposition",
            `attachment; filename="${safeDownloadName(name)}-${safeDownloadName(version)}.tar.gz"`,
          )
          .send(createReadStream(archivePath));
      return reply.code(404).send({
        error: {
          code: "archive_missing",
          message: "The archive file is missing from disk storage.",
        },
      });
    },
  );

  const startUpload = async (request: FastifyRequest, reply: FastifyReply) => {
    await prunePendingUploads();
    if (pendingUploads.size >= maxPendingUploadSessions)
      return reply
        .code(503)
        .type(hostedContentType)
        .send({
          error: {
            code: "upload_capacity_reached",
            message: "Too many uploads are pending. Retry shortly.",
          },
        });
    const actorPendingUploads = [...pendingUploads.values()].filter(
      (upload) => upload.actor.id === request.actor!.id,
    ).length;
    if (actorPendingUploads >= maxPendingUploadSessionsPerActor)
      return reply
        .code(429)
        .type(hostedContentType)
        .send({
          error: {
            code: "upload_actor_capacity_reached",
            message:
              "This account has too many pending uploads. Finish one or retry after it expires.",
          },
        });
    const uploadId = randomUUID();
    pendingUploads.set(uploadId, {
      actor: {
        id: request.actor!.id,
        username: request.actor!.username,
        role: request.actor!.role,
      },
      createdAt: Date.now(),
    });
    return reply.type(hostedContentType).send({
      url: `${baseUrl(request)}/api/uploads/${uploadId}`,
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
      await prunePendingUploads();
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
      if (pending.archivePath)
        return reply
          .code(409)
          .type(hostedContentType)
          .send({
            error: {
              code: "archive_already_uploaded",
              message: "This upload session already contains an archive.",
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
      try {
        const temporary = await saveMultipartUpload(file);
        pending.archivePath = temporary.path;
        pending.temporaryDirectory = temporary.directory;
        pending.filename = file.filename;
        pending.uploadedAt = new Date().toISOString();
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode !== 413) {
          request.log.error({ err: error }, "Could not persist upload");
          return reply
            .code(500)
            .type(hostedContentType)
            .send({
              error: {
                code: "upload_failed",
                message: "The upload could not be stored.",
              },
            });
        }
        return reply
          .code(413)
          .type(hostedContentType)
          .send({
            error: {
              code: "archive_too_large",
              message: "The package archive exceeds the upload size limit.",
            },
          });
      }
      const finalizeUrl = `${baseUrl(request)}/api/packages/versions/newUploadFinish?uploadId=${uploadId}`;
      return reply.header("Location", finalizeUrl).code(204).send();
    },
  );

  app.get(
    "/api/packages/versions/newUploadFinish",
    { preHandler: scopes("packages:publish") },
    async (request, reply) => {
      await prunePendingUploads();
      const uploadId = String(
        (request.query as { uploadId?: string }).uploadId ?? "",
      );
      const pending = pendingUploads.get(uploadId);
      if (!pending?.archivePath)
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
          pending.archivePath,
          pending.actor,
        );
        pendingUploads.delete(uploadId);
        if (pending.temporaryDirectory)
          await rm(pending.temporaryDirectory, {
            recursive: true,
            force: true,
          });
        return reply.type(hostedContentType).send({
          success: {
            message: `Published ${published.name} ${published.version} successfully; analysis has been queued.`,
          },
        });
      } catch (error) {
        pendingUploads.delete(uploadId);
        if (pending.temporaryDirectory)
          await rm(pending.temporaryDirectory, {
            recursive: true,
            force: true,
          });
        const failure = publishFailure(error);
        request.log[failure.statusCode >= 500 ? "error" : "warn"](
          { uploadId, err: error },
          "Package finalization rejected the uploaded archive",
        );
        return reply
          .code(failure.statusCode)
          .type(hostedContentType)
          .send({
            error: {
              code: failure.code,
              message: failure.message,
            },
          });
      }
    },
  );

  // Private control-plane API.
  app.get("/v1/stats", async () => repository.getStats());

  app.get("/v1/search", { preHandler: optionalAuth }, async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const result = await repository.search(
      query.q,
      query,
      repositoryActor(request.actor),
    );
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

  app.get(
    "/v1/packages/:name",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const { name } = nameParams.parse(request.params);
      if (!(await canReadPackage(request, reply, name))) return;
      const options = packageDetailQuery.parse(request.query);
      const detail = await repository.getPackage(name, options);
      return (
        detail ??
        reply.code(404).send({
          error: "not_found",
          message: `Package ${name} was not found.`,
        })
      );
    },
  );
  app.get(
    "/v1/packages/:name/versions/:version",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const { name, version } = versionParams.parse(request.params);
      if (!(await canReadPackage(request, reply, name))) return;
      return (
        (await repository.getVersion(name, version)) ??
        reply.code(404).send({ error: "not_found" })
      );
    },
  );
  app.get(
    "/v1/packages/:name/versions/:version/files",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const { name, version } = versionParams.parse(request.params);
      if (!(await canReadPackage(request, reply, name))) return;
      const entries = await repository.getFiles(name, version, {
        includeContent: false,
      });
      if (!entries) return reply.code(404).send({ error: "not_found" });
      return {
        package: name,
        version,
        entries,
      };
    },
  );
  app.get(
    "/v1/packages/:name/versions/:version/files/*",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const params = request.params as {
        name: string;
        version: string;
        "*": string;
      };
      if (!(await canReadPackage(request, reply, params.name))) return;
      return (
        (await repository.getFile(params.name, params.version, params["*"])) ??
        reply.code(404).send({ error: "not_found" })
      );
    },
  );
  app.get(
    "/v1/packages/:name/versions/:version/score",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const { name, version } = versionParams.parse(request.params);
      if (!(await canReadPackage(request, reply, name))) return;
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
      let temporary: { path: string; directory: string } | undefined;
      try {
        temporary = await saveMultipartUpload(file);
        const published = await repository.publishArchive(temporary.path, {
          id: request.actor!.id,
          username: request.actor!.username,
          role: request.actor!.role,
        });
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
        const failure = publishFailure(error);
        if (failure.statusCode === 413)
          return reply.code(413).send({
            error: "archive_too_large",
            message: "File package vượt quá giới hạn upload cho phép.",
          });
        if (failure.statusCode === 403)
          return reply.code(403).send({
            error: "package_permission_denied",
            message: failure.message,
          });
        if (failure.statusCode === 409)
          return reply.code(409).send({
            error: "version_exists",
            message: failure.message,
          });
        request.log[failure.statusCode >= 500 ? "error" : "warn"](
          { filename: file.filename, err: error },
          "File import rejected",
        );
        return reply.code(failure.statusCode).send({
          error: failure.code,
          message:
            failure.statusCode >= 500
              ? "Không thể xuất bản package do lỗi máy chủ."
              : failure.message,
        });
      } finally {
        if (temporary)
          await rm(temporary.directory, { recursive: true, force: true });
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
      if (request.actor!.authType === "token")
        return reply.code(403).send({
          error: "session_required",
          message: "Sign in with an account session to manage tokens.",
        });
      const input = tokenRequestSchema.parse(request.body);
      return reply
        .code(201)
        .send(
          await issueToken(
            repository,
            input,
            request.actor!.id,
            request.actor!.scopes,
          ),
        );
    },
  );
  app.get(
    "/v1/tokens",
    { preHandler: scopes("tokens:write") },
    async (request, reply) =>
      request.actor!.authType === "token"
        ? reply.code(403).send({ error: "session_required" })
        : { items: await repository.listTokens(request.actor!.id) },
  );
  app.delete(
    "/v1/tokens/:id",
    { preHandler: scopes("tokens:write") },
    async (request, reply) =>
      request.actor!.authType === "token"
        ? reply.code(403).send({ error: "session_required" })
        : (await repository.revokeToken(
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

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function safeDownloadName(value: string) {
  return value.replace(/[^a-zA-Z0-9._+-]/g, "_");
}

function validateLoopbackRedirect(raw: string) {
  const redirect = new URL(raw);
  const loopback =
    redirect.hostname === "127.0.0.1" ||
    redirect.hostname === "[::1]" ||
    redirect.hostname === "::1" ||
    redirect.hostname === "localhost";
  if (
    redirect.protocol !== "http:" ||
    !loopback ||
    !redirect.port ||
    redirect.pathname !== "/oauth/callback" ||
    redirect.username ||
    redirect.password ||
    redirect.hash
  ) {
    const error = new Error(
      "OAuth redirect_uri must be an HTTP loopback callback with an ephemeral port.",
    ) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
}

function oauthLoginPage(
  input: ReturnType<typeof oauthAuthorizeSchema.parse>,
  error?: string,
) {
  const hidden = Object.entries({
    response_type: input.response_type,
    client_id: input.client_id,
    redirect_uri: input.redirect_uri,
    code_challenge: input.code_challenge,
    code_challenge_method: input.code_challenge_method,
    state: input.state,
    scope: input.scope,
  })
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(String(value))}">`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Private Pub CLI</title>
<body>
  <main>
    <h1>Authorize Private Pub CLI</h1>
    <p>Sign in to grant: ${escapeHtml(input.scope)}</p>
    ${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}
    <form method="post" action="/oauth/authorize">
      ${hidden}
      <label>Username <input name="username" autocomplete="username" required></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">Authorize CLI</button>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

function publishFailure(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (error instanceof InvalidArchiveError)
    return {
      statusCode: 400,
      code: "invalid_archive",
      message: error.message,
    };
  const statusCode =
    typeof (error as { statusCode?: unknown })?.statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
  if (statusCode === 403)
    return {
      statusCode,
      code: "package_permission_denied",
      message:
        error instanceof Error
          ? error.message
          : "The current account cannot publish this package.",
    };
  if (statusCode === 409)
    return {
      statusCode,
      code: "version_exists",
      message:
        error instanceof Error
          ? error.message
          : "The package version already exists.",
    };
  if (statusCode === 413)
    return {
      statusCode,
      code: "archive_too_large",
      message: "The package archive exceeds the configured size limit.",
    };
  return {
    statusCode: 500,
    code: "internal_error",
    message: "The package could not be published due to a server error.",
  };
}

async function saveMultipartUpload(file: MultipartFile) {
  const directory = await mkdtemp(join(tmpdir(), "private-pub-upload-"));
  const path = join(directory, "archive.tar.gz");
  const maxBytes = positiveNumber(
    process.env.MAX_ARCHIVE_BYTES,
    100 * 1024 * 1024,
  );
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const error = new Error(
          `Package archive exceeds compressed size limit (${maxBytes} bytes).`,
        ) as Error & { statusCode?: number };
        error.statusCode = 413;
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      file.file,
      limiter,
      createWriteStream(path, { flags: "wx" }),
    );
    if (file.file.truncated) {
      const error = new Error(
        `Package archive exceeds compressed size limit (${maxBytes} bytes).`,
      ) as Error & { statusCode?: number };
      error.statusCode = 413;
      throw error;
    }
    return { path, directory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
