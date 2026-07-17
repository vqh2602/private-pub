import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
try { loadEnvFile(resolve(monorepoRoot, ".env")); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const nextConfig: NextConfig = {
  transpilePackages: ["@private-pub/ui", "@private-pub/contracts"],
  outputFileTracingRoot: monorepoRoot,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Content-Security-Policy", value: `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; connect-src 'self' http://localhost:4000 ws://localhost:3000` }
    ] }];
  }
};
export default nextConfig;
