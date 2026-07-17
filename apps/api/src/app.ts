import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { ZodError } from "zod";
import { DemoRegistryRepository } from "./repository.js";
import { registerRoutes } from "./routes.js";

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: Number(process.env.MAX_ARCHIVE_BYTES ?? 52_428_800) });
  await app.register(cors, { origin: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
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
  await registerRoutes(app, new DemoRegistryRepository());
  return app;
}
