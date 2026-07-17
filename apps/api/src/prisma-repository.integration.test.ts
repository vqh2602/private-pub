import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaRegistryRepository } from "./prisma-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))("Prisma registry repository", () => {
  let repository: PrismaRegistryRepository;
  let storageDirectory: string;

  beforeAll(async () => {
    storageDirectory = await mkdtemp(
      join(tmpdir(), "private-pub-prisma-test-"),
    );
    repository = new PrismaRegistryRepository(
      storageDirectory,
      "test.internal",
    );
    await repository.initialize();
  });

  afterAll(async () => {
    await repository?.close();
    if (storageDirectory)
      await rm(storageDirectory, { recursive: true, force: true });
  });

  it("publishes, indexes, paginates, and updates the current version", async () => {
    const archive = await readFile(
      resolve(
        process.cwd(),
        "../../fixtures/archives/sample_package-1.0.0.tar.gz",
      ),
    );
    await repository.publishArchive(archive, {
      id: "account-1",
      username: "db-user",
    });

    const search = await repository.search("safe", {
      sdk: ["dart"],
      hasPreview: true,
      page: 1,
      limit: 1,
    });
    expect(search).toMatchObject({
      total: 1,
      items: [{ name: "sample_package", latestVersion: "1.0.0" }],
    });
    expect(await repository.getPackageMetadata("sample_package")).toMatchObject(
      {
        latestVersion: { version: "1.0.0", retractedAt: null },
        versions: [{ version: "1.0.0" }],
      },
    );
    expect(
      await repository.getPackage("sample_package", {
        includeVersions: false,
        includeFiles: false,
      }),
    ).toMatchObject({
      latestVersion: { version: "1.0.0" },
      versions: [],
      files: [],
    });
    expect(await repository.listPublishedPackages(["db-user"])).toMatchObject([
      {
        package: { name: "sample_package" },
        versions: [{ version: "1.0.0", publishedBy: "db-user" }],
      },
    ]);

    await repository.setRetraction("sample_package", "1.0.0", true);
    expect(
      (await repository.getPackageMetadata("sample_package"))?.latestVersion
        .retractedAt,
    ).toBeTruthy();
  });
});
