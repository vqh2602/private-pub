import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { importRequestSchema, searchQuerySchema, tokenRequestSchema } from "@private-pub/contracts";
import { z } from "zod";
import type { PackageVersion } from "@private-pub/contracts";
import type { RegistryRepository } from "./domain.js";
import { hashSecret, issueToken, newSession, requireScopes, sessionCookieName } from "./security.js";
import { hashPassword, verifyPassword } from "./password.js";

const nameParams = z.object({ name: z.string() });
const versionParams = nameParams.extend({ version: z.string() });
const hostedContentType = "application/vnd.pub.v2+json; charset=utf-8";
const loginSchema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(256) });
const passwordSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(10).max(256) });

function sessionCookieOptions(expiresAt?: string) {
  return { path: "/", httpOnly: true, sameSite: "lax" as const, secure: process.env.COOKIE_SECURE === "true", ...(expiresAt ? { expires: new Date(expiresAt) } : {}) };
}

function hostedVersion(request: FastifyRequest, name: string, item: PackageVersion) {
  return {
    version: item.version,
    pubspec: item.pubspec,
    archive_url: `${request.protocol}://${request.host}/api/packages/${name}/versions/${item.version}.tar.gz`,
    archive_sha256: item.archiveSha256,
    published: item.publishedAt,
    retracted: Boolean(item.retractedAt)
  };
}

export async function registerRoutes(app: FastifyInstance, repository: RegistryRepository) {
  const pendingUploads = new Map<string, { archive?: Buffer; filename?: string; uploadedAt?: string }>();
  const scopes = (...required: Parameters<typeof requireScopes>[1][]) => requireScopes(repository, ...required);
  app.get("/health", async () => ({ status: "ok", mode: repository.mode, timestamp: new Date().toISOString() }));

  app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const account = await repository.findAccountByUsername(input.username);
    if (!account?.isActive || !(await verifyPassword(input.password, account.passwordHash))) return reply.code(401).send({ error: "invalid_credentials", message: "Username or password is incorrect." });
    const session = newSession();
    await repository.createSession(account.id, session.tokenHash, session.expiresAt);
    return reply.setCookie(sessionCookieName, session.plaintext, sessionCookieOptions(session.expiresAt)).send({ user: { id: account.id, username: account.username, role: account.role, mustChangePassword: account.mustChangePassword } });
  });
  app.get("/v1/auth/me", { preHandler: scopes("packages:read") }, async (request) => ({ user: { id: request.actor!.id, username: request.actor!.username, role: request.actor!.role, mustChangePassword: request.actor!.mustChangePassword } }));
  app.post("/v1/auth/logout", async (request, reply) => {
    const session = request.cookies[sessionCookieName];
    if (session) await repository.revokeSession(hashSecret(session));
    return reply.clearCookie(sessionCookieName, sessionCookieOptions()).code(204).send();
  });
  app.patch("/v1/auth/password", { preHandler: scopes("packages:read") }, async (request, reply) => {
    if (request.actor!.authType !== "session" || !request.actor!.username) return reply.code(403).send({ error: "session_required", message: "Sign in with your account to change the password." });
    const input = passwordSchema.parse(request.body);
    const account = await repository.findAccountByUsername(request.actor!.username);
    if (!account || !(await verifyPassword(input.currentPassword, account.passwordHash))) return reply.code(400).send({ error: "invalid_current_password", message: "Current password is incorrect." });
    await repository.updatePassword(account.id, await hashPassword(input.newPassword));
    return reply.clearCookie(sessionCookieName, sessionCookieOptions()).code(204).send();
  });

  // Hosted Pub Repository API V2 read surface.
  app.get("/api/packages/:name", async (request, reply) => {
    const { name } = nameParams.parse(request.params);
    const detail = await repository.getPackage(name);
    if (!detail) return reply.code(404).type(hostedContentType).send({ error: { code: "not_found", message: `Package ${name} was not found.` } });
    const versions = detail.versions.map((item) => hostedVersion(request, name, item));
    const latest = versions.find((item) => item.version === detail.latestVersion.version) ?? versions[0];
    return reply.type(hostedContentType).send({
      name,
      latest,
      versions,
      ...(detail.package.isDiscontinued ? { isDiscontinued: true } : {})
    });
  });

  app.get("/api/packages/:name/versions/:version", async (request, reply) => {
    const { name, version } = versionParams.parse(request.params);
    const item = await repository.getVersion(name, version);
    const detail = await repository.getPackage(name);
    if (!item || !detail) return reply.code(404).type(hostedContentType).send({ error: { code: "not_found", message: "Package version was not found." } });
    return reply.type(hostedContentType).send(hostedVersion(request, name, item));
  });

  app.get("/api/packages/:name/versions/:version.tar.gz", async (request, reply) => {
    const { name, version } = versionParams.parse(request.params);
    if (!(await repository.getVersion(name, version))) return reply.code(404).send({ error: { code: "not_found", message: "Archive was not found." } });
    const archive = await repository.getArchive(name, version);
    if (archive) return reply.type("application/octet-stream").header("Content-Disposition", `attachment; filename="${name}-${version}.tar.gz"`).send(archive);
    return reply.code(501).send({ error: { code: "archive_adapter_required", message: "Configure S3ArchiveStore for binary archives. Metadata and publish flow are available in demo mode." } });
  });

  const startUpload = async (request: FastifyRequest, reply: FastifyReply) => {
    const uploadId = randomUUID();
    pendingUploads.set(uploadId, {});
    return reply.type(hostedContentType).send({
      url: `${request.protocol}://${request.host}/api/uploads/${uploadId}`,
      fields: { uploadId }
    });
  };
  app.get("/api/packages/versions/new", { preHandler: scopes("packages:publish") }, startUpload);
  // Compatibility alias for early clients of this scaffold. `dart pub` uses `/new`.
  app.get("/api/packages/versions/newUpload", { preHandler: scopes("packages:publish") }, startUpload);

  app.post("/api/uploads/:uploadId", { preHandler: scopes("packages:publish") }, async (request, reply) => {
    const { uploadId } = request.params as { uploadId: string };
    const pending = pendingUploads.get(uploadId);
    if (!pending) return reply.code(404).type(hostedContentType).send({ error: { code: "upload_not_found", message: "The upload session is missing or expired." } });
    const file = await request.file();
    if (!file) return reply.code(400).type(hostedContentType).send({ error: { code: "archive_missing", message: "Expected multipart field 'file' containing a .tar.gz archive." } });
    pending.archive = await file.toBuffer();
    pending.filename = file.filename;
    pending.uploadedAt = new Date().toISOString();
    const finalizeUrl = `${request.protocol}://${request.host}/api/packages/versions/newUploadFinish?uploadId=${uploadId}`;
    return reply.header("Location", finalizeUrl).code(204).send();
  });

  app.get("/api/packages/versions/newUploadFinish", { preHandler: scopes("packages:publish") }, async (request, reply) => {
    const uploadId = String((request.query as { uploadId?: string }).uploadId ?? "");
    const pending = pendingUploads.get(uploadId);
    if (!pending?.archive) return reply.code(400).type(hostedContentType).send({ error: { code: "upload_incomplete", message: "No uploaded archive was found for this publish session." } });
    try {
      const published = await repository.publishArchive(pending.archive);
      pendingUploads.delete(uploadId);
      return reply.type(hostedContentType).send({ success: { message: `Published ${published.name} ${published.version} successfully; analysis has been queued.` } });
    } catch (error) {
      pendingUploads.delete(uploadId);
      const message = error instanceof Error ? error.message : "The uploaded archive could not be published.";
      request.log.warn({ uploadId, error: message }, "Package finalization rejected the uploaded archive");
      return reply.code(400).type(hostedContentType).send({ error: { code: "invalid_archive", message } });
    }
  });

  // Private control-plane API.
  app.get("/v1/search", async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const packages = await repository.search(query.q, query);
    return { items: packages.slice((query.page - 1) * query.limit, query.page * query.limit), total: packages.length, page: query.page, limit: query.limit };
  });

  app.get("/v1/packages/:name", async (request, reply) => {
    const { name } = nameParams.parse(request.params);
    const detail = await repository.getPackage(name);
    return detail ?? reply.code(404).send({ error: "not_found", message: `Package ${name} was not found.` });
  });
  app.get("/v1/packages/:name/versions/:version", async (request, reply) => {
    const { name, version } = versionParams.parse(request.params);
    return (await repository.getVersion(name, version)) ?? reply.code(404).send({ error: "not_found" });
  });
  app.get("/v1/packages/:name/versions/:version/files", async (request, reply) => {
    const { name, version } = versionParams.parse(request.params);
    return { package: name, version, entries: (await repository.getFiles(name, version)) ?? reply.code(404).send({ error: "not_found" }) };
  });
  app.get("/v1/packages/:name/versions/:version/files/*", async (request, reply) => {
    const params = request.params as { name: string; version: string; "*": string };
    return (await repository.getFile(params.name, params.version, params["*"])) ?? reply.code(404).send({ error: "not_found" });
  });
  app.get("/v1/packages/:name/versions/:version/score", async (request, reply) => {
    const { name, version } = versionParams.parse(request.params);
    return (await repository.getScore(name, version)) ?? reply.code(404).send({ error: "not_found" });
  });

  app.post("/v1/imports/pubdev", { preHandler: scopes("imports:write") }, async (request, reply) => {
    const input = importRequestSchema.parse(request.body);
    const job = await repository.createImport({ packageName: input.packageName, versions: input.versions, mode: input.mode });
    return reply.code(202).send(job);
  });
  app.get("/v1/imports", { preHandler: scopes("packages:read") }, async () => ({ items: await repository.listImports() }));
  app.get("/v1/imports/:jobId", { preHandler: scopes("packages:read") }, async (request, reply) => (await repository.getImport((request.params as { jobId: string }).jobId)) ?? reply.code(404).send({ error: "not_found" }));
  app.post("/v1/analyses/recompute", { preHandler: scopes("packages:admin") }, async (request, reply) => reply.code(202).send({ id: `ana_${randomUUID().slice(0, 16)}`, status: "queued", input: request.body }));

  app.post("/v1/tokens", { preHandler: scopes("tokens:write") }, async (request, reply) => {
    const input = tokenRequestSchema.parse(request.body);
    return reply.code(201).send(await issueToken(repository, input, request.actor!.id));
  });
  app.get("/v1/tokens", { preHandler: scopes("tokens:write") }, async (request) => ({ items: await repository.listTokens(request.actor!.id) }));
  app.delete("/v1/tokens/:id", { preHandler: scopes("tokens:write") }, async (request, reply) => (await repository.revokeToken((request.params as { id: string }).id, request.actor!.id)) ? reply.code(204).send() : reply.code(404).send({ error: "not_found" }));

  for (const [suffix, retracted] of [["retract", true], ["restore", false]] as const) {
    app.post(`/v1/packages/:name/versions/:version/${suffix}`, { preHandler: scopes("packages:admin") }, async (request, reply) => {
      const { name, version } = versionParams.parse(request.params);
      return (await repository.setRetraction(name, version, retracted)) ?? reply.code(404).send({ error: "not_found" });
    });
  }
  for (const [suffix, discontinued] of [["discontinue", true], ["undiscontinue", false]] as const) {
    app.post(`/v1/packages/:name/${suffix}`, { preHandler: scopes("packages:admin") }, async (request, reply) => {
      const { name } = nameParams.parse(request.params);
      return (await repository.setDiscontinued(name, discontinued)) ?? reply.code(404).send({ error: "not_found" });
    });
  }
}
