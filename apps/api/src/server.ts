import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
try { loadEnvFile(resolve(monorepoRoot, ".env")); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const { buildApp } = await import("./app.js");

const app = await buildApp();
const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
