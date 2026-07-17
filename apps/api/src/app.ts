import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import { ZodError } from "zod";
import { DemoRegistryRepository } from "./repository.js";
import { PrismaRegistryRepository } from "./prisma-repository.js";
import { registerRoutes } from "./routes.js";

export async function buildApp() {
  const maxArchiveBytes = Number(process.env.MAX_ARCHIVE_BYTES ?? 100 * 1024 * 1024);
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true, bodyLimit: maxArchiveBytes });
  await app.register(cors, { origin: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { files: 1, fileSize: maxArchiveBytes, fields: 20 }
  });
  await app.register(swagger, { openapi: { info: { title: "Private Pub Registry API", version: "0.1.0" }, tags: [{ name: "pub", description: "Hosted Pub Repository API V2" }, { name: "control-plane", description: "Private application API" }] } });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.decorateRequest("actor");
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "validation_error", issues: error.issues });
    const normalized = error instanceof Error ? error : new Error("Unknown error");
    const candidate = normalized as Error & { statusCode?: number };
    const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : 500;
    return reply.code(statusCode).send({ error: statusCode === 500 ? "internal_error" : normalized.name, message: normalized.message });
  });
  const storageDirectory = process.env.ARCHIVE_STORAGE_DIR ?? process.env.DEMO_STORAGE_DIR ?? ".private-pub-data/archives";
  const publisherId = process.env.PUBLISHER_ID?.trim() || "platform.internal";
  const repository = process.env.DEMO_MODE === "false" && process.env.NODE_ENV !== "test"
    ? new PrismaRegistryRepository(storageDirectory, publisherId)
    : new DemoRegistryRepository(process.env.NODE_ENV === "test" ? undefined : storageDirectory, publisherId);
  await repository.initialize();
  app.addHook("onClose", async () => repository.close?.());
  await registerRoutes(app, repository);
  return app;
}
