import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RegistryRepository, TokenRecord } from "./domain.js";

export type Scope = "packages:read" | "packages:publish" | "packages:admin" | "imports:write" | "tokens:write";

declare module "fastify" {
  interface FastifyRequest { actor?: { id: string; scopes: Scope[] } }
}

const demoScopes: Scope[] = ["packages:read", "packages:publish", "packages:admin", "imports:write", "tokens:write"];

export function requireScopes(...required: Scope[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (process.env.DEMO_MODE !== "false" && (!header || header === "Bearer demo-admin-token")) {
      request.actor = { id: "demo-admin", scopes: demoScopes };
      return;
    }
    if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthorized", message: "A bearer token is required." });
    // Production adapter point: hash token, load its active record, then hydrate scopes.
    request.actor = { id: "token-user", scopes: ["packages:read"] };
    if (!required.every((scope) => request.actor?.scopes.includes(scope))) return reply.code(403).send({ error: "forbidden", requiredScopes: required });
  };
}

export async function issueToken(repository: RegistryRepository, input: { name: string; scopes: Scope[]; expiresInDays: number }, subjectId: string) {
  const plaintext = `pp_${randomBytes(28).toString("base64url")}`;
  const pepper = process.env.TOKEN_PEPPER ?? "local-development-only";
  const token: TokenRecord = {
    id: randomUUID(),
    name: input.name,
    prefix: plaintext.slice(0, 10),
    scopes: input.scopes,
    tokenHash: createHash("sha256").update(`${pepper}:${plaintext}`).digest("hex"),
    expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString(),
    revokedAt: null
  };
  await repository.saveToken(token);
  return { id: token.id, token: plaintext, prefix: token.prefix, scopes: token.scopes, expiresAt: token.expiresAt };
}
