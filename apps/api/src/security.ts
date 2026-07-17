import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AccountRecord, RegistryRepository, TokenRecord } from "./domain.js";

export type Scope = "packages:read" | "packages:publish" | "packages:admin" | "imports:write" | "tokens:write";

declare module "fastify" {
  interface FastifyRequest { actor?: { id: string; username?: string; role?: AccountRecord["role"]; mustChangePassword?: boolean; authType: "session" | "token" | "demo"; scopes: Scope[] } }
}

export const allScopes: Scope[] = ["packages:read", "packages:publish", "packages:admin", "imports:write", "tokens:write"];
export const sessionCookieName = "private_pub_session";

export function requireScopes(repository: RegistryRepository, ...required: Scope[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (process.env.DEMO_MODE !== "false" && (!header || header === "Bearer demo-admin-token")) {
      request.actor = { id: "demo-admin", username: "admin", role: "super_admin", mustChangePassword: false, authType: "demo", scopes: allScopes };
      return;
    }
    const session = request.cookies[sessionCookieName];
    if (session) {
      const account = await repository.authenticateSession(hashSecret(session));
      if (account) {
        request.actor = { id: account.id, username: account.username, role: account.role, mustChangePassword: account.mustChangePassword, authType: "session", scopes: scopesForRole(account.role) };
        if (account.mustChangePassword && required.some((scope) => scope !== "packages:read")) return reply.code(403).send({ error: "password_change_required", message: "Change the default password before performing privileged actions." });
        if (!required.every((scope) => request.actor?.scopes.includes(scope))) return reply.code(403).send({ error: "forbidden", requiredScopes: required });
        return;
      }
    }
    if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthorized", message: "A bearer token is required." });
    const plaintext = header.slice("Bearer ".length);
    const token = await repository.authenticateToken(hashSecret(plaintext));
    if (!token) return reply.code(401).send({ error: "unauthorized", message: "The bearer token is invalid, expired, or revoked." });
    request.actor = { id: token.id, username: token.username, role: token.role, authType: "token", scopes: token.scopes.filter(isScope) };
    if (!required.every((scope) => request.actor?.scopes.includes(scope))) return reply.code(403).send({ error: "forbidden", requiredScopes: required });
  };
}

function isScope(value: string): value is Scope { return allScopes.includes(value as Scope); }

export function scopesForRole(role: AccountRecord["role"]): Scope[] {
  return role === "user" ? ["packages:read"] : allScopes;
}

export function hashSecret(value: string) {
  const pepper = process.env.TOKEN_PEPPER ?? "local-development-only";
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}

export function newSession() {
  const plaintext = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + Number(process.env.SESSION_TTL_HOURS ?? 12) * 3_600_000).toISOString();
  return { plaintext, tokenHash: hashSecret(plaintext), expiresAt };
}

export async function issueToken(repository: RegistryRepository, input: { name: string; scopes: Scope[]; expiresInDays: number | null }, subjectId: string) {
  const plaintext = `pp_${randomBytes(28).toString("base64url")}`;
  const token: TokenRecord = {
    id: randomUUID(),
    subjectId,
    name: input.name,
    prefix: plaintext.slice(0, 10),
    scopes: input.scopes,
    tokenHash: hashSecret(plaintext),
    expiresAt: input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString(),
    revokedAt: null
  };
  await repository.saveToken(token);
  return { id: token.id, token: plaintext, prefix: token.prefix, scopes: token.scopes, expiresAt: token.expiresAt };
}
