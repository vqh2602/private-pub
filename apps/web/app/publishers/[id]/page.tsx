import { PackageCard } from "@/components/package-card";
import { MyPublishedPackages } from "@/components/my-published-packages";
import { searchPackages } from "@/lib/api";
import { Badge } from "@private-pub/ui";
import { Building2, CheckCircle2, Globe2, Mail } from "lucide-react";

export default async function PublisherPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const rawPage = Number((await searchParams).page ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const result = await searchPackages("", "updated", { publisher: id }, page);
  const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
  return (
    <main className="subpage">
      <section className="subpage-hero">
        <div className="content-shell publisher-title">
          <div className="publisher-logo">
            <Building2 />
          </div>
          <div>
            <Badge tone="green">
              <CheckCircle2 size={12} />
              Verified publisher
            </Badge>
            <h1>{id}</h1>
            <p>
              Shared platform capabilities for mobile and web product teams.
            </p>
            <div className="package-meta">
              <span>
                <Globe2 size={15} />
                {id}
              </span>
              <span>
                <Mail size={15} />
                platform-team@internal
              </span>
            </div>
          </div>
        </div>
      </section>
      <div className="content-shell compact-content">
        <MyPublishedPackages />
        <section className="publisher-catalogue">
          <span className="eyebrow">Published packages</span>
          <h2>
            {result.total} packages thuộc {id}
          </h2>
          <div className="package-list">
            {result.items.map((item) => (
              <PackageCard key={item.name} item={item} />
            ))}
          </div>
          {result.total > result.limit && (
            <nav className="pagination" aria-label="Publisher package pages">
              {page > 1 ? (
                <a href={`?page=${page - 1}`}>← Previous</a>
              ) : (
                <span />
              )}
              <span>
                Page {Math.min(page, totalPages)} / {totalPages}
              </span>
              {page < totalPages ? (
                <a href={`?page=${page + 1}`}>Next →</a>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
