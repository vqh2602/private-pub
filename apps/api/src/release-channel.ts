import type { ReleaseChannel } from "@private-pub/contracts";
import semver from "semver";

const knownChannels: Exclude<ReleaseChannel, "stable" | "prerelease">[] = ["dev", "alpha", "beta", "rc"];

export function releaseChannel(version: string): ReleaseChannel {
  const identifiers = semver.prerelease(version);
  if (!identifiers) return "stable";

  const labels = identifiers.filter((identifier): identifier is string => typeof identifier === "string").map((identifier) => identifier.toLowerCase());
  return knownChannels.find((channel) => labels.some((label) => label === channel || label.startsWith(channel))) ?? "prerelease";
}

/** Matches pub.dev's latest-version behavior: prefer the newest stable release. */
export function selectLatestRelease<T extends { version: string; retractedAt?: unknown }>(versions: T[]): T | undefined {
  const available = versions.filter((version) => !version.retractedAt);
  const candidates = available.length ? available : versions;
  const stable = candidates.filter((version) => releaseChannel(version.version) === "stable");
  return [...(stable.length ? stable : candidates)].sort((a, b) => semver.rcompare(a.version, b.version))[0];
}
