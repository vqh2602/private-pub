"use client";

import { PackageCard } from "@/components/package-card";
import type { PackageSummary, PackageVersion } from "@private-pub/contracts";
import { Badge } from "@private-pub/ui";
import { LoaderCircle, PackageOpen, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type User = { username: string };
type PublishedPackage = { package: PackageSummary; versions: PackageVersion[] };

export function MyPublishedPackages() {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<PublishedPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const meResponse = await fetch("/api/auth/me", { cache: "no-store", signal: controller.signal });
        if (meResponse.status === 401) { setSignedOut(true); return; }
        if (!meResponse.ok) throw new Error("Không thể đọc tài khoản đang đăng nhập.");
        const me = await meResponse.json() as { user: User };
        setUser(me.user);

        const packagesResponse = await fetch("/api/registry/packages/mine", { cache: "no-store", signal: controller.signal });
        if (!packagesResponse.ok) throw new Error("Không thể tải các gói đã publish.");
        const payload = await packagesResponse.json() as { items: PublishedPackage[] };
        setItems(payload.items);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Không thể tải dữ liệu publish.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const versionCount = items.reduce((total, item) => total + item.versions.length, 0);
  return <section className="my-published-packages">
    <div className="publisher-section-heading">
      <div><span className="eyebrow">Tài khoản đang đăng nhập</span><h2>Gói và phiên bản của bạn</h2><p>{user ? `Các bản phát hành được ghi nhận bởi ${user.username}.` : "Các bản phát hành được ghi nhận theo tài khoản publish."}</p></div>
      {user && <Badge tone="blue"><UserRound size={12} />{user.username} · {items.length} gói · {versionCount} phiên bản</Badge>}
    </div>
    {loading && <div className="publisher-state"><LoaderCircle className="spin" />Đang tải các bản publish…</div>}
    {signedOut && <div className="publisher-state"><UserRound /><div><strong>Đăng nhập để xem các gói của bạn</strong><p>Danh sách này chỉ hiển thị các version do chính tài khoản hiện tại publish.</p><Link href="/login">Đi đến đăng nhập →</Link></div></div>}
    {error && <div className="publisher-state publisher-error" role="alert">{error}</div>}
    {!loading && !signedOut && !error && items.length === 0 && <div className="publisher-state"><PackageOpen /><div><strong>Chưa có bản publish nào</strong><p>Sau khi publish bằng token của tài khoản này, package và version sẽ xuất hiện tại đây.</p></div></div>}
    {!loading && items.map((item) => <article className="owned-package" key={item.package.name}>
      <PackageCard item={item.package} />
      <div className="owned-versions"><strong>Phiên bản do {user?.username ?? "bạn"} publish</strong>{item.versions.map((version) => <Link key={version.version} href={`/packages/${encodeURIComponent(item.package.name)}?tab=versions`}><Badge tone="blue">v{version.version}</Badge><span>{new Date(version.publishedAt).toLocaleDateString("vi-VN")}</span>{version.retractedAt && <Badge tone="red">Đã thu hồi</Badge>}</Link>)}</div>
    </article>)}
  </section>;
}
