import {
  flutterDownloadUrl,
  getFlutterReleases,
  type FlutterChannel,
  type FlutterPlatform,
} from "@/lib/flutter-releases";
import { Badge, StatCard } from "@private-pub/ui";
import {
  CalendarDays,
  Download,
  ExternalLink,
  Search,
  Smartphone,
} from "lucide-react";

type Params = {
  q?: string;
  platform?: string;
  channel?: string;
  page?: string;
};
const platforms: FlutterPlatform[] = ["windows", "macos", "linux"];
const channels: FlutterChannel[] = ["stable", "beta", "dev"];

export default async function FlutterSdkPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const platform = platforms.includes(params.platform as FlutterPlatform)
    ? (params.platform as FlutterPlatform)
    : "windows";
  const channel = channels.includes(params.channel as FlutterChannel)
    ? (params.channel as FlutterChannel)
    : undefined;
  const query = (params.q ?? "").trim().toLowerCase();
  const requestedPage = Math.max(1, Number(params.page) || 1);

  try {
    const archive = await getFlutterReleases(platform);
    const currentHashes = new Set(Object.values(archive.current_release));
    const matching = archive.releases.filter(
      (release) =>
        (!channel || release.channel === channel) &&
        (!query ||
          [
            release.version,
            release.dart_sdk_version,
            release.hash,
            release.channel,
          ].some((value) => value.toLowerCase().includes(query))),
    );
    const pageSize = 40;
    const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const rows = matching.slice((page - 1) * pageSize, page * pageSize);
    const latestStable = archive.releases.find(
      (release) => release.hash === archive.current_release.stable,
    );
    const stableCount = archive.releases.filter(
      (release) => release.channel === "stable",
    ).length;
    const betaCount = archive.releases.filter(
      (release) => release.channel === "beta",
    ).length;

    return (
      <main className="subpage flutter-sdk-page">
        <section className="subpage-hero">
          <div className="content-shell flutter-heading">
            <span className="big-package-icon">
              <Smartphone />
            </span>
            <div>
              <span className="eyebrow">Flutter release explorer</span>
              <h1>Flutter SDK</h1>
              <p>
                Tìm kiếm, thống kê và tải các bản Flutter chính thức cho từng hệ
                điều hành.
              </p>
            </div>
          </div>
        </section>
        <div className="content-shell compact-content">
          <div className="score-grid flutter-stats">
            <StatCard
              label="Bản phát hành"
              value={archive.releases.length.toLocaleString("vi-VN")}
              detail={`Kho lưu trữ dành cho ${platformLabel(platform)}`}
            />
            <StatCard
              label="Stable"
              value={stableCount.toLocaleString("vi-VN")}
              detail={
                latestStable
                  ? `Mới nhất: Flutter ${latestStable.version}`
                  : "Các bản stable"
              }
              accent="green"
            />
            <StatCard
              label="Beta"
              value={betaCount.toLocaleString("vi-VN")}
              detail="Các bản beta trong kho lưu trữ"
              accent="purple"
            />
          </div>
          <form className="flutter-release-filters">
            <label>
              <Search />
              <input
                name="q"
                defaultValue={params.q}
                placeholder="Tìm Flutter, Dart SDK hoặc commit…"
              />
            </label>
            <select
              name="platform"
              defaultValue={platform}
              aria-label="Hệ điều hành"
            >
              {platforms.map((item) => (
                <option value={item} key={item}>
                  {platformLabel(item)}
                </option>
              ))}
            </select>
            <select
              name="channel"
              defaultValue={channel ?? ""}
              aria-label="Kênh phát hành"
            >
              <option value="">Tất cả kênh</option>
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
              <option value="dev">Dev</option>
            </select>
            <button className="primary-button">Tìm kiếm</button>
          </form>
          <section className="table-card flutter-release-table">
            <div className="table-title">
              <div>
                <span className="eyebrow">
                  Official archive · {platformLabel(platform)}
                </span>
                <h2>
                  {matching.length.toLocaleString("vi-VN")} phiên bản phù hợp
                </h2>
              </div>
              <a
                href="https://docs.flutter.dev/install/archive"
                target="_blank"
                rel="noreferrer"
              >
                Kho Flutter chính thức <ExternalLink />
              </a>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Flutter</th>
                    <th>Kênh</th>
                    <th>Dart SDK</th>
                    <th>Ngày phát hành</th>
                    <th>Kiến trúc</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((release) => (
                    <tr key={`${release.hash}-${release.archive}`}>
                      <td>
                        <div className="release-version">
                          <strong>{release.version}</strong>
                          {currentHashes.has(release.hash) && (
                            <Badge tone="blue">Hiện tại</Badge>
                          )}
                          <code>{release.hash.slice(0, 10)}</code>
                        </div>
                      </td>
                      <td>
                        <Badge
                          tone={
                            release.channel === "stable"
                              ? "green"
                              : release.channel === "beta"
                                ? "amber"
                                : "neutral"
                          }
                        >
                          {release.channel}
                        </Badge>
                      </td>
                      <td>{release.dart_sdk_version}</td>
                      <td>
                        <CalendarDays />
                        {new Date(release.release_date).toLocaleDateString(
                          "vi-VN",
                        )}
                      </td>
                      <td>{release.dart_sdk_arch ?? "—"}</td>
                      <td>
                        <a
                          className="download-button"
                          href={flutterDownloadUrl(archive, release)}
                          title={`Tải Flutter ${release.version}`}
                        >
                          <Download />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="empty-results">
                <Search />
                <h3>Không tìm thấy phiên bản</h3>
                <p>Thử từ khóa khác hoặc bỏ bộ lọc kênh phát hành.</p>
              </div>
            )}
            {totalPages > 1 && (
              <nav className="pagination">
                {page > 1 && (
                  <a href={pageUrl(params, page - 1)}>← Trang trước</a>
                )}
                <span>
                  Trang {page} / {totalPages}
                </span>
                {page < totalPages && (
                  <a href={pageUrl(params, page + 1)}>Trang sau →</a>
                )}
              </nav>
            )}
          </section>
        </div>
      </main>
    );
  } catch (error) {
    return (
      <main className="subpage">
        <div className="content-shell compact-content">
          <div className="empty-results">
            <Smartphone />
            <h1>Không thể tải danh sách Flutter SDK</h1>
            <p>
              {error instanceof Error
                ? error.message
                : "Nguồn dữ liệu Flutter tạm thời không khả dụng."}
            </p>
          </div>
        </div>
      </main>
    );
  }
}

function platformLabel(platform: FlutterPlatform) {
  if (platform === "macos") return "macOS";
  if (platform === "linux") return "Linux";
  return "Windows";
}

function pageUrl(params: Params, page: number) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.platform) query.set("platform", params.platform);
  if (params.channel) query.set("channel", params.channel);
  query.set("page", String(page));
  return `/flutter?${query}`;
}
