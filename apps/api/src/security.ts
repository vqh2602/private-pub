import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  AccountRecord,
  AccessActor,
  RegistryRepository,
  TokenRecord,
} from "./domain.js";

export type Scope =
  | "packages:read"
  | "packages:publish"
  | "packages:admin"
  | "imports:write"
  | "tokens:write";

declare module "fastify" {
  interface FastifyRequest {
    actor?: {
      id: string;
      username?: string;
      role?: AccountRecord["role"];
      mustChangePassword?: boolean;
      authType: "session" | "token" | "demo";
      scopes: Scope[];
    };
  }
}

export const allScopes: Scope[] = [
  "packages:read",
  "packages:publish",
  "packages:admin",
  "imports:write",
  "tokens:write",
];
export const sessionCookieName = "private_pub_session";

export async function authenticateRequest(
  repository: RegistryRepository,
  request: FastifyRequest,
) {
  if (request.actor) return request.actor;
  const header = request.headers.authorization;
  if (
    process.env.DEMO_MODE === "true" &&
    (!header || header === "Bearer demo-admin-token")
  ) {
    request.actor = {
      id: "demo-admin",
      username: "admin",
      role: "super_admin",
      mustChangePassword: false,
      authType: "demo",
      scopes: allScopes,
    };
    return request.actor;
  }
  const session = request.cookies[sessionCookieName];
  if (session) {
    const account = await repository.authenticateSession(hashSecret(session));
    if (account) {
      request.actor = {
        id: account.id,
        username: account.username,
        role: account.role,
        mustChangePassword: account.mustChangePassword,
        authType: "session",
        scopes: scopesForRole(account.role),
      };
      return request.actor;
    }
  }
  if (!header?.startsWith("Bearer ")) return null;
  const plaintext = header.slice("Bearer ".length).trim();
  if (!plaintext) return null;
  const token = await repository.authenticateToken(hashSecret(plaintext));
  if (!token) return null;
  request.actor = {
    id: token.id,
    username: token.username,
    role: token.role,
    authType: "token",
    scopes: token.scopes.filter(isScope),
  };
  return request.actor;
}

export function optionalAuthentication(repository: RegistryRepository) {
  return async (request: FastifyRequest) => {
    await authenticateRequest(repository, request);
  };
}

export function requireScopes(
  repository: RegistryRepository,
  ...required: Scope[]
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const actor = await authenticateRequest(repository, request);
    if (!actor)
      return reply.code(401).send({
        error: "unauthorized",
        message: "A valid session or bearer token is required.",
      });
    if (
      actor.mustChangePassword &&
      required.some((scope) => scope !== "packages:read")
    )
      return reply.code(403).send({
        error: "password_change_required",
        message:
          "Change the default password before performing privileged actions.",
      });
    if (!required.every((scope) => actor.scopes.includes(scope)))
      return reply
        .code(403)
        .send({ error: "forbidden", requiredScopes: required });
  };
}

function isScope(value: string): value is Scope {
  return allScopes.includes(value as Scope);
}

export function scopesForRole(role: AccountRecord["role"]): Scope[] {
  return role === "user"
    ? ["packages:read", "packages:publish", "imports:write", "tokens:write"]
    : allScopes;
}

export function repositoryActor(
  actor: FastifyRequest["actor"],
): AccessActor | undefined {
  return actor
    ? { id: actor.id, username: actor.username, role: actor.role }
    : undefined;
}

export function hashSecret(value: string) {
  const pepper = process.env.TOKEN_PEPPER ?? "local-development-only";
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}

export function newSession() {
  const plaintext = randomBytes(32).toString("base64url");
  const ttlHours = Number(process.env.SESSION_TTL_HOURS ?? 12);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 24 * 30)
    throw new Error(
      "SESSION_TTL_HOURS must be greater than 0 and at most 720 hours.",
    );
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
  return { plaintext, tokenHash: hashSecret(plaintext), expiresAt };
}

export async function issueToken(
  repository: RegistryRepository,
  input: { name: string; scopes: Scope[]; expiresInDays: number | null },
  subjectId: string,
  issuerScopes: readonly Scope[],
) {
  if (!input.scopes.every((scope) => issuerScopes.includes(scope))) {
    const error = new Error(
      "A token cannot grant scopes its issuer does not have.",
    ) as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }
  const plaintext = `pp_${randomBytes(28).toString("base64url")}`;
  const token: TokenRecord = {
    id: randomUUID(),
    subjectId,
    name: input.name,
    prefix: plaintext.slice(0, 10),
    scopes: input.scopes,
    tokenHash: hashSecret(plaintext),
    expiresAt:
      input.expiresInDays === null
        ? null
        : new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString(),
    revokedAt: null,
  };
  await repository.saveToken(token);
  return {
    id: token.id,
    token: plaintext,
    prefix: token.prefix,
    scopes: token.scopes,
    expiresAt: token.expiresAt,
  };
}
