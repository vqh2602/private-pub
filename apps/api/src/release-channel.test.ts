import { describe, expect, it } from "vitest";
import { releaseChannel, selectLatestRelease } from "./release-channel.js";

describe("release channels", () => {
  it.each([
    ["2.3.1", "stable"],
    ["2.4.0-rc.1", "rc"],
    ["2.4.0-beta.2", "beta"],
    ["2.4.0-alpha.3", "alpha"],
    ["2.4.0-dev.4", "dev"],
    ["2.4.0-preview.1", "prerelease"]
  ] as const)("classifies %s as %s", (version, channel) => {
    expect(releaseChannel(version)).toBe(channel);
  });

  it("prefers the newest stable version over a numerically newer prerelease", () => {
    expect(selectLatestRelease([{ version: "2.3.1" }, { version: "2.4.0-beta.1" }])?.version).toBe("2.3.1");
  });

  it("uses the newest prerelease when no stable version exists", () => {
    expect(selectLatestRelease([{ version: "1.0.0-dev.1" }, { version: "1.1.0-beta.1" }])?.version).toBe("1.1.0-beta.1");
  });

  it("does not select a retracted stable release when another version is available", () => {
    expect(selectLatestRelease([{ version: "2.0.0", retractedAt: "now" }, { version: "1.9.0", retractedAt: null }])?.version).toBe("1.9.0");
  });
});
