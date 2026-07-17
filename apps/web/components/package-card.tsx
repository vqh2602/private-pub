import type { PackageSummary } from "@private-pub/contracts";
import { Badge } from "@private-pub/ui";
import { ArrowUpRight, Box, CheckCircle2, Download, Eye, Star } from "lucide-react";
import Link from "next/link";

export function PackageCard({ item }: { item: PackageSummary }) {
  return <article className="package-card">
    <div className="package-icon"><Box size={23} /></div>
    <div className="package-main">
      <div className="package-heading"><Link href={`/packages/${item.name}`}>{item.name}</Link><Badge tone="blue">v{item.latestVersion}</Badge>{item.isDiscontinued && <Badge tone="amber">Discontinued</Badge>}</div>
      <p>{item.description}</p>
      <div className="package-meta"><span><CheckCircle2 size={14} />{item.publisherId}</span><span>Updated {formatDate(item.updatedAt)}</span>{item.topics.map((topic) => <Badge key={topic}>{topic}</Badge>)}</div>
    </div>
    <div className="package-stats">
      <span><Star size={15} />{item.score} pts</span><span><Download size={15} />{item.downloads30d.toLocaleString()}</span>{item.hasPreview && <span><Eye size={15} />Preview</span>}
      <Link className="arrow-link" href={`/packages/${item.name}`} aria-label={`Open ${item.name}`}><ArrowUpRight size={18} /></Link>
    </div>
  </article>;
}

function formatDate(date: string) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(date)); }
