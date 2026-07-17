import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { validateArchiveIndex } from "./archive.js";

describe("registry API", () => {
  let app: FastifyInstance;
  beforeAll(async () => { process.env.NODE_ENV = "test"; process.env.DEMO_MODE = "true"; app = await buildApp(); });
  afterAll(async () => app.close());

  it("serves Hosted Pub V2 metadata", async () => {
    const response = await app.inject({ method: "GET", url: "/api/packages/aurora_ui" });
    expect(response.statusCode).toBe(200);
    expect(response.json().versions[0].archive_url).toContain("2.3.1.tar.gz");
  });
  it("ranks exact names first", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/search?q=aurora_ui" });
    expect(response.json().items[0].name).toBe("aurora_ui");
  });
  it("supports retract and restore", async () => {
    const retracted = await app.inject({ method: "POST", url: "/v1/packages/aurora_ui/versions/2.3.1/retract" });
    expect(retracted.json().retractedAt).toBeTruthy();
    const restored = await app.inject({ method: "POST", url: "/v1/packages/aurora_ui/versions/2.3.1/restore" });
    expect(restored.json().retractedAt).toBeNull();
  });
});

describe("archive validation", () => {
  it("rejects traversal and unsafe symlinks", () => {
    const result = validateArchiveIndex([{ path: "../secret", size: 12, type: "file" }, { path: "lib/current", size: 0, type: "symlink", linkPath: "/etc/passwd" }]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
  it("accepts a normal Dart package index", () => {
    expect(validateArchiveIndex([{ path: "pubspec.yaml", size: 120, type: "file" }, { path: "lib/main.dart", size: 400, type: "file" }]).valid).toBe(true);
  });
});
