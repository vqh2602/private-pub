import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { ZodError } from "zod";
import { DemoRegistryRepository } from "./repository.js";
import { PrismaRegistryRepository } from "./prisma-repository.js";
import { registerRoutes } from "./routes.js";

export async function buildApp() {
  validateSecurityConfiguration();
  const maxArchiveBytes = positiveInteger(
    "MAX_ARCHIVE_BYTES",
    100 * 1024 * 1024,
  );
  const trustedProxies = process.env.TRUST_PROXY?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: trustedProxies?.length ? trustedProxies : false,
    bodyLimit: maxArchiveBytes,
  });
  const configuredOrigins = process.env.CORS_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins?.length
    ? configuredOrigins
    : process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:3000", "http://127.0.0.1:3000"];
  await app.register(cors, {
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: allowedOrigins.length > 0,
  });
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin;
    const requestOrigin = `${request.protocol}://${request.host}`;
    if (origin && origin !== requestOrigin && !allowedOrigins.includes(origin))
      return reply.code(403).send({ error: "origin_rejected" });
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, {
    limits: { files: 1, fileSize: maxArchiveBytes, fields: 20 },
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Private Pub Registry API", version: "0.1.1" },
      tags: [
        { name: "pub", description: "Hosted Pub Repository API V2" },
        { name: "control-plane", description: "Private application API" },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.decorateRequest("actor");
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ error: "validation_error", issues: error.issues });
    const normalized =
      error instanceof Error ? error : new Error("Unknown error");
    const candidate = normalized as Error & { statusCode?: number };
    const statusCode =
      typeof candidate.statusCode === "number" ? candidate.statusCode : 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? "internal_error" : normalized.name,
      message:
        statusCode === 500
          ? "An unexpected server error occurred."
          : normalized.message,
    });
  });
  const storageDirectory =
    process.env.ARCHIVE_STORAGE_DIR ??
    process.env.DEMO_STORAGE_DIR ??
    ".private-pub-data/archives";
  const publisherId = process.env.PUBLISHER_ID?.trim() || "platform.internal";
  const repository =
    process.env.DEMO_MODE === "true"
      ? new DemoRegistryRepository(
          process.env.NODE_ENV === "test" ? undefined : storageDirectory,
          publisherId,
        )
      : new PrismaRegistryRepository(storageDirectory, publisherId);
  await repository.initialize();
  app.addHook("onClose", async () => repository.close?.());
  await registerRoutes(app, repository);
  return app;
}

function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}

function validateSecurityConfiguration() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.DEMO_MODE !== "false")
    throw new Error("Production requires DEMO_MODE=false.");
  if ((process.env.TOKEN_PEPPER?.length ?? 0) < 32)
    throw new Error(
      "Production requires TOKEN_PEPPER with at least 32 characters.",
    );
  if (process.env.COOKIE_SECURE !== "true")
    throw new Error("Production requires COOKIE_SECURE=true.");
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl || new URL(publicBaseUrl).protocol !== "https:")
    throw new Error("Production requires an HTTPS PUBLIC_BASE_URL.");
  if (!process.env.CORS_ORIGINS?.trim())
    throw new Error("Production requires an explicit CORS_ORIGINS allowlist.");
}
