import { join } from "node:path";
import { mkdirSync } from "node:fs";

process.env.TMPDIR = join(process.cwd(), ".tmp-test");
mkdirSync(process.env.TMPDIR, { recursive: true });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import {
  parsePackageArchive,
  readArchiveTextFile,
  validateArchiveIndex,
} from "./archive.js";
import { packageDetailSchema } from "@private-pub/contracts";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DemoRegistryRepository, hashToken } from "./repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { issueToken } from "./security.js";
import { clearSystemInfoCache } from "./system-info.js";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

function multipartArchive(archive: Buffer, filename = "package.tar.gz") {
  const boundary = `----private-pub-${Math.random().toString(16).slice(2)}`;
  return {
    boundary,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/gzip\r\n\r\n`,
      ),
      archive,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

function archiveWithVersion(archive: Buffer, from: string, to: string) {
  if (from.length !== to.length)
    throw new Error("Fixture versions must have the same length.");
  const tarball = gunzipSync(archive);
  const marker = Buffer.from(`version: ${from}`);
  const offset = tarball.indexOf(marker);
  if (offset < 0) throw new Error(`Could not find fixture version ${from}.`);
  tarball.set(Buffer.from(`version: ${to}`), offset);
  return gzipSync(tarball);
}

describe("registry API", () => {
  let app: FastifyInstance;
  let originalPublicBaseUrl: string | undefined;
  let originalTrustProxy: string | undefined;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DEMO_MODE = "true";
    originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    originalTrustProxy = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    app = await buildApp();
  });
  afterAll(async () => {
    if (originalPublicBaseUrl !== undefined) {
      process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
    } else {
      delete process.env.PUBLIC_BASE_URL;
    }
    if (originalTrustProxy !== undefined) {
      process.env.TRUST_PROXY = originalTrustProxy;
    } else {
      delete process.env.TRUST_PROXY;
    }
    await app.close();
  });

  it("serves Hosted Pub V2 metadata", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/packages/aurora_ui",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.pub.v2+json",
    );
    expect(response.json().versions[0].archive_url).toContain("2.3.1.tar.gz");
    expect(response.json().latest).toEqual(response.json().versions[0]);
    expect(response.json().latest.pubspec.dependencies.flutter).toEqual({
      sdk: "flutter",
    });
  });
  it("completes the CLI OAuth authorization-code flow with PKCE", async () => {
    const verifier =
      "private-pub-cli-verifier-abcdefghijklmnopqrstuvwxyz-0123456789";
    const challenge = createHash("sha256")
      .update(verifier, "ascii")
      .digest("base64url");
    const redirectUri = "http://127.0.0.1:43123/oauth/callback";
    const query = new URLSearchParams({
      response_type: "code",
      client_id: "private_pub_cli",
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "oauth-state-1234",
      scope: "packages:read packages:publish",
    });
    const authorization = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${query}`,
    });
    expect(authorization.statusCode).toBe(302);
    const callback = new URL(authorization.headers.location!);
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("oauth-state-1234");
    const code = callback.searchParams.get("code")!;

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "private_pub_cli",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString();
    const exchanged = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: tokenBody,
    });
    expect(exchanged.statusCode).toBe(200);
    expect(exchanged.json().access_token).toMatch(/^pp_/);
    expect(exchanged.json().username).toBe("admin");

    const profile = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${exchanged.json().access_token}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().user.id).toBe("demo-admin");

    const replay = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: tokenBody,
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error).toBe("invalid_grant");
  });
  it("rejects non-loopback OAuth redirect URIs", async () => {
    const query = new URLSearchParams({
      response_type: "code",
      client_id: "private_pub_cli",
      redirect_uri: "https://attacker.example/oauth/callback",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      state: "oauth-state-1234",
      scope: "packages:read",
    });
    const response = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${query}`,
    });
    expect(response.statusCode).toBe(400);
  });
  it("ranks exact names first", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/search?q=aurora_ui",
    });
    expect(response.json().items[0].name).toBe("aurora_ui");
  });
  it("paginates package search without changing the total", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v1/search?sort=updated&page=1&limit=2",
    });
    const second = await app.inject({
      method: "GET",
      url: "/v1/search?sort=updated&page=2&limit=2",
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ total: 4, page: 1, limit: 2 });
    expect(second.json()).toMatchObject({ total: 4, page: 2, limit: 2 });
    expect(first.json().items).toHaveLength(2);
    expect(second.json().items).toHaveLength(2);
    expect(
      first.json().items.map((item: { name: string }) => item.name),
    ).not.toEqual(
      second.json().items.map((item: { name: string }) => item.name),
    );
  });
  it("returns live registry statistics", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/stats" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      packages: 4,
      versions: 9,
      analyzedVersions: 9,
    });
  });
  it("reports the application and FVM-managed SDK versions", async () => {
    clearSystemInfoCache();
    process.env.APP_VERSION = "1.2.3";
    process.env.SYSTEM_FVM_VERSION = "3.2.1";
    process.env.SYSTEM_FLUTTER_VERSION = "3.41.9";
    process.env.SYSTEM_DART_VERSION = "3.11.5";
    const response = await app.inject({
      method: "GET",
      url: "/v1/system/info",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      appVersion: "1.2.3",
      sdkProvider: "fvm",
      fvmVersion: "3.2.1",
      flutterVersion: "3.41.9",
      dartVersion: "3.11.5",
      available: true,
    });
  });

  it("reports the application and system-managed SDK versions when FVM is not used", async () => {
    clearSystemInfoCache();
    process.env.APP_VERSION = "1.2.3";
    const previousFvm = process.env.SYSTEM_FVM_VERSION;
    delete process.env.SYSTEM_FVM_VERSION;
    process.env.SYSTEM_FLUTTER_VERSION = "3.41.9";
    process.env.SYSTEM_DART_VERSION = "3.11.5";
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/system/info",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        appVersion: "1.2.3",
        sdkProvider: "system",
        fvmVersion: null,
        flutterVersion: "3.41.9",
        dartVersion: "3.11.5",
        available: true,
      });
    } finally {
      if (previousFvm !== undefined) {
        process.env.SYSTEM_FVM_VERSION = previousFvm;
      }
    }
  });
  it("rejects unsafe cross-origin state changes", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { origin: "https://attacker.example" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("origin_rejected");
  });
  it("creates and lists user accounts without exposing password hashes", async () => {
    const username = `developer_${Date.now()}`;
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/accounts",
      payload: { username, password: "temporary-password", role: "user" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().user).toEqual(
      expect.objectContaining({
        username,
        role: "user",
        mustChangePassword: true,
      }),
    );
    expect(created.json().user.passwordHash).toBeUndefined();

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/accounts",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toContainEqual(
      expect.objectContaining({ username }),
    );
    expect(
      listed
        .json()
        .items.find((item: { username: string }) => item.username === username)
        .passwordHash,
    ).toBeUndefined();

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/admin/accounts",
      payload: { username, password: "temporary-password", role: "user" },
    });
    expect(duplicate.statusCode).toBe(409);
  });
  it("deletes user accounts and enforces permissions", async () => {
    // Create a user
    const username = `dev_to_delete_${Date.now()}`;
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/accounts",
      payload: { username, password: "temporary-password", role: "user" },
    });
    expect(created.statusCode).toBe(201);
    const userId = created.json().user.id;

    // Verify it is listed
    const listedBefore = await app.inject({
      method: "GET",
      url: "/v1/admin/accounts",
    });
    expect(listedBefore.json().items).toContainEqual(
      expect.objectContaining({ id: userId }),
    );

    // Delete the user
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/admin/accounts/${userId}`,
    });
    expect(deleted.statusCode).toBe(204);

    // Verify it is no longer listed
    const listedAfter = await app.inject({
      method: "GET",
      url: "/v1/admin/accounts",
    });
    expect(listedAfter.json().items).not.toContainEqual(
      expect.objectContaining({ id: userId }),
    );

    // Try deleting non-existent account
    const nonExistent = await app.inject({
      method: "DELETE",
      url: `/v1/admin/accounts/non-existent-id`,
    });
    expect(nonExistent.statusCode).toBe(404);

    // Try self-deletion (demo-admin is the current actor under DEMO_MODE)
    const selfDelete = await app.inject({
      method: "DELETE",
      url: `/v1/admin/accounts/demo-admin`,
    });
    expect(selfDelete.statusCode).toBe(400);
    expect(selfDelete.json().error).toBe("self_deletion_forbidden");
  });
  it("combines SDK, platform, and quality filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/search?sdk=flutter&platform=web&hasPreview=true&minScore=150",
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json().items.map((item: { name: string }) => item.name),
    ).toEqual(["secure_storage_plus"]);

    const multipleSdk = await app.inject({
      method: "GET",
      url: "/v1/search?sdk=flutter&sdk=dart&minScore=140",
    });
    expect(multipleSdk.statusCode).toBe(200);
    expect(multipleSdk.json().items).toHaveLength(3);

    const withoutPreview = await app.inject({
      method: "GET",
      url: "/v1/search?hasPreview=false",
    });
    expect(
      withoutPreview.json().items.map((item: { name: string }) => item.name),
    ).toEqual(["legacy_networking"]);
  });
  it("returns SDK requirements and direct dependencies", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/packages/aurora_ui",
    });
    const detail = packageDetailSchema.parse(response.json());
    expect(detail.requirements.dartSdkMinimum).toBe("3.4.0");
    expect(detail.requirements.flutterMinimum).toBe("3.22.0");
    expect(detail.dependencies).toContainEqual(
      expect.objectContaining({ name: "collection", constraint: "^1.19.0" }),
    );
    expect(detail.latestVersion.releaseChannel).toBe("stable");
    expect(detail.versions).toContainEqual(
      expect.objectContaining({
        version: "2.4.0-beta.1",
        releaseChannel: "beta",
      }),
    );
    expect(detail.versions).toContainEqual(
      expect.objectContaining({
        version: "2.4.0-dev.2",
        releaseChannel: "dev",
      }),
    );
  });
  it("can omit heavy version and file collections from package details", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/packages/aurora_ui?includeVersions=false&includeFiles=false",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().latestVersion.version).toBe("2.3.1");
    expect(response.json().versions).toEqual([]);
    expect(response.json().files).toEqual([]);
  });
  it("imports a .tar.gz file, creates its package, and adds a new version", async () => {
    const isolated = await buildApp();
    try {
      const firstArchive = readFileSync(
        new URL(
          "../../../fixtures/archives/sample_package-1.0.0.tar.gz",
          import.meta.url,
        ),
      );
      const firstUpload = multipartArchive(firstArchive);
      const created = await isolated.inject({
        method: "POST",
        url: "/v1/imports/file",
        headers: {
          "content-type": `multipart/form-data; boundary=${firstUpload.boundary}`,
        },
        payload: firstUpload.body,
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toEqual(
        expect.objectContaining({
          packageName: "sample_package",
          version: "1.0.0",
          action: "package_created",
        }),
      );
      const scored = await isolated.inject({
        method: "GET",
        url: "/v1/packages/sample_package/versions/1.0.0/score",
      });
      expect(scored.statusCode).toBe(200);
      expect(scored.json().grantedPoints).toBeGreaterThan(0);
      expect(scored.json().breakdown).toHaveLength(5);

      const fileIndex = await isolated.inject({
        method: "GET",
        url: "/v1/packages/sample_package/versions/1.0.0/files",
      });
      expect(fileIndex.statusCode).toBe(200);
      expect(
        fileIndex
          .json()
          .entries.every(
            (entry: { content?: string }) => entry.content === undefined,
          ),
      ).toBe(true);
      const sourceFile = await isolated.inject({
        method: "GET",
        url: "/v1/packages/sample_package/versions/1.0.0/files/lib/sample_package.dart",
      });
      expect(sourceFile.statusCode).toBe(200);
      expect(sourceFile.json().content).toContain("fixtureGreeting");
      const downloaded = await isolated.inject({
        method: "GET",
        url: "/api/packages/sample_package/versions/1.0.0.tar.gz",
      });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers["content-type"]).toContain("application/gzip");
      expect(downloaded.rawPayload.equals(firstArchive)).toBe(true);

      const secondUpload = multipartArchive(
        archiveWithVersion(firstArchive, "1.0.0", "1.1.0"),
      );
      const versionAdded = await isolated.inject({
        method: "POST",
        url: "/v1/imports/file",
        headers: {
          "content-type": `multipart/form-data; boundary=${secondUpload.boundary}`,
        },
        payload: secondUpload.body,
      });
      expect(versionAdded.statusCode).toBe(201);
      expect(versionAdded.json()).toEqual(
        expect.objectContaining({
          packageName: "sample_package",
          version: "1.1.0",
          action: "version_added",
        }),
      );

      const duplicateUpload = multipartArchive(firstArchive);
      const duplicate = await isolated.inject({
        method: "POST",
        url: "/v1/imports/file",
        headers: {
          "content-type": `multipart/form-data; boundary=${duplicateUpload.boundary}`,
        },
        payload: duplicateUpload.body,
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().error).toBe("version_exists");
    } finally {
      await isolated.close();
    }
  });
  it("implements the dart pub multipart publish handshake", async () => {
    const negotiation = await app.inject({
      method: "GET",
      url: "/api/packages/versions/new",
      headers: {
        accept: "application/vnd.pub.v2+json",
        authorization: "Bearer demo-admin-token",
      },
    });
    expect(negotiation.statusCode).toBe(200);
    expect(negotiation.headers["content-type"]).toContain(
      "application/vnd.pub.v2+json",
    );
    const { url, fields } = negotiation.json<{
      url: string;
      fields: { uploadId: string };
    }>();
    const boundary = "----private-pub-contract-test";
    const archive = readFileSync(
      new URL(
        "../../../fixtures/archives/sample_package-1.0.0.tar.gz",
        import.meta.url,
      ),
    );
    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="uploadId"\r\n\r\n${fields.uploadId}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="package.tar.gz"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      archive,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: "POST",
      url: new URL(url).pathname,
      headers: {
        authorization: "Bearer demo-admin-token",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody,
    });
    expect(upload.statusCode).toBe(204);
    expect(upload.headers.location).toContain(
      "/api/packages/versions/newUploadFinish?uploadId=",
    );
    const finalize = await app.inject({
      method: "GET",
      url:
        new URL(upload.headers.location!).pathname +
        new URL(upload.headers.location!).search,
      headers: {
        authorization: "Bearer demo-admin-token",
        accept: "application/vnd.pub.v2+json",
      },
    });
    expect(finalize.statusCode).toBe(200);
    expect(finalize.json().success.message).toContain(
      "Published sample_package 1.0.0 successfully",
    );
    const published = await app.inject({
      method: "GET",
      url: "/api/packages/sample_package",
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().latest.version).toBe("1.0.0");
    expect(published.json().latest).toEqual(published.json().versions[0]);
    expect(published.json().latest.pubspec.environment.sdk).toBe(
      ">=3.4.0 <4.0.0",
    );
    const mine = await app.inject({
      method: "GET",
      url: "/v1/packages/mine",
      headers: { authorization: "Bearer demo-admin-token" },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items).toContainEqual(
      expect.objectContaining({
        package: expect.objectContaining({ name: "sample_package" }),
        versions: expect.arrayContaining([
          expect.objectContaining({ version: "1.0.0", publishedBy: "admin" }),
        ]),
      }),
    );
    const downloaded = await app.inject({
      method: "GET",
      url: "/api/packages/sample_package/versions/1.0.0.tar.gz",
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.rawPayload.equals(archive)).toBe(true);
  });
  it("bounds unfinished upload sessions", async () => {
    const previousLimit = process.env.MAX_PENDING_UPLOAD_SESSIONS;
    process.env.MAX_PENDING_UPLOAD_SESSIONS = "1";
    const isolated = await buildApp();
    try {
      const headers = { authorization: "Bearer demo-admin-token" };
      const first = await isolated.inject({
        method: "GET",
        url: "/api/packages/versions/new",
        headers,
      });
      const second = await isolated.inject({
        method: "GET",
        url: "/api/packages/versions/new",
        headers,
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(503);
      expect(second.json().error.code).toBe("upload_capacity_reached");
    } finally {
      await isolated.close();
      if (previousLimit === undefined)
        delete process.env.MAX_PENDING_UPLOAD_SESSIONS;
      else process.env.MAX_PENDING_UPLOAD_SESSIONS = previousLimit;
    }
  });
  it("prevents another account from publishing an owned package", async () => {
    const repository = new DemoRegistryRepository();
    await repository.initialize();
    const firstArchive = readFileSync(
      new URL(
        "../../../fixtures/archives/sample_package-1.0.0.tar.gz",
        import.meta.url,
      ),
    );
    await repository.publishArchive(firstArchive, {
      id: "account-alice",
      username: "alice",
    });
    await expect(
      repository.publishArchive(
        archiveWithVersion(firstArchive, "1.0.0", "1.1.0"),
        { id: "account-bob", username: "bob" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await repository.publishArchive(
      archiveWithVersion(firstArchive, "1.0.0", "1.1.0"),
      { id: "account-alice", username: "alice" },
    );

    const detail = await repository.getPackage("sample_package");
    expect(detail?.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: "1.0.0", publishedBy: "alice" }),
        expect.objectContaining({ version: "1.1.0", publishedBy: "alice" }),
      ]),
    );
    expect(detail?.latestVersion.publishedBy).toBe("alice");
  });
  it("ignores forwarded origin headers from an untrusted client", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/packages/versions/new",
      headers: {
        host: "127.0.0.1:4000",
        "x-forwarded-host": "registry.example.internal",
        "x-forwarded-proto": "https",
        authorization: "Bearer demo-admin-token",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().url).toMatch(
      /^http:\/\/127\.0\.0\.1:4000\/api\/uploads\//,
    );
  });
  it("restores published archives after a repository restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "private-pub-registry-"));
    try {
      const archive = readFileSync(
        new URL(
          "../../../fixtures/archives/sample_package-1.0.0.tar.gz",
          import.meta.url,
        ),
      );
      const first = new DemoRegistryRepository(directory);
      await first.initialize();
      await first.publishArchive(archive, {
        id: "account-1",
        username: "alice",
      });
      const restarted = new DemoRegistryRepository(directory);
      await restarted.initialize();
      expect(
        (await restarted.getPackage("sample_package"))?.latestVersion.version,
      ).toBe("1.0.0");
      expect(
        readFileSync(
          (await restarted.getArchivePath("sample_package", "1.0.0"))!,
        ).equals(archive),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("supports retract and restore", async () => {
    const retracted = await app.inject({
      method: "POST",
      url: "/v1/packages/aurora_ui/versions/2.3.1/retract",
    });
    expect(retracted.json().retractedAt).toBeTruthy();
    const restored = await app.inject({
      method: "POST",
      url: "/v1/packages/aurora_ui/versions/2.3.1/restore",
    });
    expect(restored.json().retractedAt).toBeNull();
  });

  it("manages package permissions and enforces authorization", async () => {
    const u1 = `user1_${Date.now()}`;
    const u2 = `user2_${Date.now()}`;

    const user1Created = await app.inject({
      method: "POST",
      url: "/v1/admin/accounts",
      payload: { username: u1, password: "password123", role: "user" },
    });
    const user2Created = await app.inject({
      method: "POST",
      url: "/v1/admin/accounts",
      payload: { username: u2, password: "password123", role: "user" },
    });

    expect(user1Created.statusCode).toBe(201);
    expect(user2Created.statusCode).toBe(201);

    const user1 = user1Created.json().user;
    const user2 = user2Created.json().user;

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/packages/sample_package/permissions",
      headers: { authorization: "Bearer demo-admin-token" },
    });
    expect(listRes.statusCode).toBe(200);

    const grantRes = await app.inject({
      method: "POST",
      url: "/v1/packages/sample_package/permissions",
      headers: { authorization: "Bearer demo-admin-token" },
      payload: { username: u1, role: "PACKAGE_WRITER" },
    });
    expect(grantRes.statusCode).toBe(200);
    expect(grantRes.json().permission).toMatchObject({
      subjectId: user1.id,
      role: "PACKAGE_WRITER",
      username: u1,
    });

    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/v1/packages/sample_package/permissions/${user1.id}`,
      headers: { authorization: "Bearer demo-admin-token" },
    });
    expect(revokeRes.statusCode).toBe(204);
  });
});

describe("archive validation", () => {
  it("indexes from disk without retaining source contents in memory", async () => {
    const archivePath = fileURLToPath(
      new URL(
        "../../../fixtures/archives/sample_package-1.0.0.tar.gz",
        import.meta.url,
      ),
    );
    const parsed = await parsePackageArchive(archivePath);
    expect(parsed.files.length).toBeGreaterThan(0);
    expect(parsed.files.every((file) => file.content === undefined)).toBe(true);
    expect(
      await readArchiveTextFile(archivePath, "lib/sample_package.dart"),
    ).toContain("fixtureGreeting");
    expect(
      await readArchiveTextFile(archivePath, "lib/missing.dart"),
    ).toBeUndefined();
  });

  it("rejects traversal and unsafe symlinks", () => {
    const result = validateArchiveIndex([
      { path: "../secret", size: 12, type: "file" },
      {
        path: "lib/current",
        size: 0,
        type: "symlink",
        linkPath: "/etc/passwd",
      },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
  it("accepts a normal Dart package index", () => {
    expect(
      validateArchiveIndex([
        { path: "pubspec.yaml", size: 120, type: "file" },
        { path: "lib/main.dart", size: 400, type: "file" },
      ]).valid,
    ).toBe(true);
  });
  it("normalizes duplicate paths and rejects Windows traversal", () => {
    const result = validateArchiveIndex([
      { path: "lib//main.dart", size: 1, type: "file" },
      { path: "lib/main.dart", size: 1, type: "file" },
      {
        path: "lib/current",
        size: 0,
        type: "symlink",
        linkPath: "..\\..\\secret",
      },
    ]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Duplicate path: lib/main.dart",
        "Unsafe symlink: lib/current",
      ]),
    );
  });
  it("matches pub.dev limits without an arbitrary per-file 10 MB cap", () => {
    const largeGeneratedFile = validateArchiveIndex([
      {
        path: "lib/generated_icons.dart",
        size: 18 * 1024 * 1024,
        type: "file",
      },
    ]);
    expect(largeGeneratedFile.valid).toBe(true);
    const oversizedArchive = validateArchiveIndex([
      { path: "assets/huge.bin", size: 257 * 1024 * 1024, type: "file" },
    ]);
    expect(oversizedArchive.errors).toContain(
      "Archive exceeds uncompressed size limit",
    );
  });
});

describe("password security", () => {
  it("hashes with a unique salt and verifies without storing plaintext", async () => {
    const first = await hashPassword("a-secure-password");
    const second = await hashPassword("a-secure-password");
    expect(first).not.toBe(second);
    expect(first).not.toContain("a-secure-password");
    expect(await verifyPassword("a-secure-password", first)).toBe(true);
    expect(await verifyPassword("wrong-password", first)).toBe(false);
  });
});

describe("personal access tokens", () => {
  it("cannot grant scopes that the issuer does not have", async () => {
    const repository = new DemoRegistryRepository();
    await expect(
      issueToken(
        repository,
        {
          name: "escalation-attempt",
          scopes: ["packages:admin"],
          expiresInDays: 30,
        },
        "account-1",
        ["packages:read", "tokens:write"],
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("allows an account token without an expiration date", async () => {
    const previousPepper = process.env.TOKEN_PEPPER;
    process.env.TOKEN_PEPPER = "test-pepper";
    try {
      const repository = new DemoRegistryRepository();
      const created = await issueToken(
        repository,
        { name: "long-lived", scopes: ["packages:read"], expiresInDays: null },
        "account-1",
        ["packages:read"],
      );
      expect(created.expiresAt).toBeNull();
      await expect(
        repository.authenticateToken(hashToken(created.token, "test-pepper")),
      ).resolves.toEqual({
        id: "account-1",
        username: undefined,
        role: undefined,
        scopes: ["packages:read"],
      });
    } finally {
      if (previousPepper === undefined) delete process.env.TOKEN_PEPPER;
      else process.env.TOKEN_PEPPER = previousPepper;
    }
  });
});
