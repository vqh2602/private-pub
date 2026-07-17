import { PackageCard } from "@/components/package-card";
import { MyPublishedPackages } from "@/components/my-published-packages";
import { searchPackages } from "@/lib/api";
import { Badge } from "@private-pub/ui";
import { Building2, CheckCircle2, Globe2, Mail } from "lucide-react";

export default async function PublisherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const packages = (await searchPackages()).filter((item) => item.publisherId === id);
  return <main className="subpage"><section className="subpage-hero"><div className="content-shell publisher-title"><div className="publisher-logo"><Building2 /></div><div><Badge tone="green"><CheckCircle2 size={12} />Verified publisher</Badge><h1>{id}</h1><p>Shared platform capabilities for mobile and web product teams.</p><div className="package-meta"><span><Globe2 size={15} />{id}</span><span><Mail size={15} />platform-team@internal</span></div></div></div></section><div className="content-shell compact-content"><MyPublishedPackages /><section className="publisher-catalogue"><span className="eyebrow">Published packages</span><h2>{packages.length} packages thuộc {id}</h2><div className="package-list">{packages.map((item) => <PackageCard key={item.name} item={item} />)}</div></section></div></main>;
}
