export type FlutterPlatform = "windows" | "macos" | "linux";
export type FlutterChannel = "stable" | "beta" | "dev";

export type FlutterRelease = {
  hash: string;
  channel: FlutterChannel;
  version: string;
  dart_sdk_version: string;
  dart_sdk_arch?: string;
  release_date: string;
  archive: string;
  sha256: string;
};

export type FlutterReleaseArchive = {
  base_url: string;
  current_release: Partial<Record<FlutterChannel, string>>;
  releases: FlutterRelease[];
};

const releaseHosts: Record<FlutterPlatform, string> = {
  windows:
    "https://storage.googleapis.com/flutter_infra_release/releases/releases_windows.json",
  macos:
    "https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json",
  linux:
    "https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json",
};

export async function getFlutterReleases(
  platform: FlutterPlatform,
): Promise<FlutterReleaseArchive> {
  const response = await fetch(releaseHosts[platform], {
    next: { revalidate: 3600 },
  });
  if (!response.ok)
    throw new Error(`Flutter release archive returned ${response.status}.`);
  const payload = (await response.json()) as FlutterReleaseArchive;
  if (!payload.base_url || !Array.isArray(payload.releases))
    throw new Error("Flutter release archive has an invalid format.");
  return payload;
}

export function flutterDownloadUrl(
  archive: FlutterReleaseArchive,
  release: FlutterRelease,
) {
  return `${archive.base_url.replace(/\/$/, "")}/${release.archive}`;
}
