import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { validateArchiveIndex } from "./archive.js";
import { packageDetailSchema } from "@private-pub/contracts";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DemoRegistryRepository, hashToken } from "./repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { issueToken } from "./security.js";
import { gunzipSync, gzipSync } from "node:zlib";

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
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DEMO_MODE = "true";
    app = await buildApp();
  });
  afterAll(async () => app.close());

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
  it("records the account that published each version of the same package", async () => {
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
    await repository.publishArchive(
      archiveWithVersion(firstArchive, "1.0.0", "1.1.0"),
      { id: "account-bob", username: "bob" },
    );

    const detail = await repository.getPackage("sample_package");
    expect(detail?.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: "1.0.0", publishedBy: "alice" }),
        expect.objectContaining({ version: "1.1.0", publishedBy: "bob" }),
      ]),
    );
    expect(detail?.latestVersion.publishedBy).toBe("bob");
  });
  it("uses the forwarded HTTPS origin behind Cloudflare or another trusted proxy", async () => {
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
      /^https:\/\/registry\.example\.internal\/api\/uploads\//,
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
        (await restarted.getArchive("sample_package", "1.0.0"))?.equals(
          archive,
        ),
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
});

describe("archive validation", () => {
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
  it("allows an account token without an expiration date", async () => {
    const previousPepper = process.env.TOKEN_PEPPER;
    process.env.TOKEN_PEPPER = "test-pepper";
    try {
      const repository = new DemoRegistryRepository();
      const created = await issueToken(
        repository,
        { name: "long-lived", scopes: ["packages:read"], expiresInDays: null },
        "account-1",
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
