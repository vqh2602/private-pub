import { PackageCard } from "@/components/package-card";
import { searchPackages } from "@/lib/api";
import { Badge } from "@private-pub/ui";
import { Boxes, ChevronDown, PackageCheck, Search, ShieldCheck, Sparkles } from "lucide-react";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string }> }) {
  const params = await searchParams;
  const items = await searchPackages(params.q ?? "", params.sort ?? "relevance");
  return <main>
    <section className="hero">
      <div className="hero-grid" />
      <div className="hero-inner">
        <Badge tone="blue"><Sparkles size={13} /> Enterprise Dart infrastructure</Badge>
        <h1>Every package your team needs.<br /><em>None you don’t trust.</em></h1>
        <p>Discover, inspect, and ship private Dart & Flutter packages from one secure registry.</p>
        <form className="hero-search"><Search size={20} /><input name="q" defaultValue={params.q} aria-label="Search packages" placeholder="Search packages, publishers, or topics…" /><button>Search registry</button></form>
        <div className="quick-filters"><span>Try:</span><a href="/?q=flutter">flutter</a><a href="/?q=security">security</a><a href="/?q=design-system">design system</a></div>
      </div>
    </section>

    <section className="trust-strip"><div><span><Boxes /></span><strong>248</strong><small>Private packages</small></div><div><span><PackageCheck /></span><strong>1,904</strong><small>Published versions</small></div><div><span><ShieldCheck /></span><strong>100%</strong><small>Analyzed artifacts</small></div></section>

    <section className="content-shell listing-section">
      <div className="section-heading"><div><span className="eyebrow">Registry catalogue</span><h2>{params.q ? `Results for “${params.q}”` : "Packages your team relies on"}</h2><p>{items.length} matching packages, ranked by quality and usage.</p></div><form className="sort-form"><input type="hidden" name="q" value={params.q ?? ""} /><label>Sort by</label><div><select name="sort" defaultValue={params.sort ?? "relevance"}><option value="relevance">Relevance</option><option value="updated">Recently updated</option><option value="downloads">Downloads</option><option value="score">Pub points</option></select><ChevronDown size={15} /></div></form></div>
      <div className="catalog-layout">
        <aside className="filters"><div className="filter-head"><strong>Filters</strong><button>Clear</button></div><Filter title="SDK" options={["Flutter", "Dart"]} /><Filter title="Platform" options={["Android", "iOS", "Web", "Desktop"]} /><Filter title="Quality" options={["Has preview", "Verified publisher", "140+ points"]} /></aside>
        <div className="package-list">{items.map((item) => <PackageCard item={item} key={item.name} />)}{items.length === 0 && <div className="empty-results"><Search /><h3>No matching packages</h3><p>Try a broader package name, topic, or publisher.</p></div>}</div>
      </div>
    </section>
  </main>;
}

function Filter({ title, options }: { title: string; options: string[] }) { return <fieldset><legend>{title}</legend>{options.map((option) => <label key={option}><input type="checkbox" /> <span>{option}</span><small>{Math.floor(20 + option.length * 7)}</small></label>)}</fieldset>; }
