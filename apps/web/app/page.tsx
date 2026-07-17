import { PackageCard } from "@/components/package-card";
import { getRegistryStats, searchPackages } from "@/lib/api";
import { Badge } from "@private-pub/ui";
import {
  Boxes,
  ChevronDown,
  PackageCheck,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type HomeSearchParams = {
  q?: string;
  sort?: string;
  sdk?: string | string[];
  platform?: string | string[];
  hasPreview?: string;
  verifiedPublisher?: string;
  minScore?: string;
  page?: string;
};

const values = (value?: string | string[]) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  const params = await searchParams;
  const sdk = values(params.sdk);
  const platform = values(params.platform);
  const requestedPage = Number(params.page ?? 1);
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const filters = {
    sdk,
    platform,
    ...(params.hasPreview === "true" ? { hasPreview: true } : {}),
    ...(params.verifiedPublisher === "true" ? { verifiedPublisher: true } : {}),
    ...(params.minScore ? { minScore: Number(params.minScore) } : {}),
  };
  const [searchResult, stats] = await Promise.all([
    searchPackages(params.q ?? "", params.sort ?? "relevance", filters, page),
    getRegistryStats(),
  ]);
  const items = searchResult.items;
  const totalPages = Math.max(
    1,
    Math.ceil(searchResult.total / searchResult.limit),
  );
  const analyzedPercent = stats.versions
    ? Math.round((stats.analyzedVersions / stats.versions) * 100)
    : 0;
  return (
    <main>
      <section className="hero">
        <div className="hero-grid" />
        <div className="hero-inner">
          <Badge tone="blue">
            <Sparkles size={13} /> Enterprise Dart infrastructure
          </Badge>
          <h1>
            Every package your team needs.
            <br />
            <em>None you don’t trust.</em>
          </h1>
          <p>
            Discover, inspect, and ship private Dart & Flutter packages from one
            secure registry.
          </p>
          <form className="hero-search">
            <Search size={20} />
            <input
              name="q"
              defaultValue={params.q}
              aria-label="Search packages"
              placeholder="Search packages, publishers, or topics…"
            />
            <button>Search registry</button>
          </form>
          <div className="quick-filters">
            <span>Try:</span>
            <a href="/?q=flutter">flutter</a>
            <a href="/?q=security">security</a>
            <a href="/?q=design-system">design system</a>
          </div>
        </div>
      </section>

      <section className="trust-strip">
        <div>
          <span>
            <Boxes />
          </span>
          <strong>{stats.packages.toLocaleString("en-US")}</strong>
          <small>Private packages</small>
        </div>
        <div>
          <span>
            <PackageCheck />
          </span>
          <strong>{stats.versions.toLocaleString("en-US")}</strong>
          <small>Published versions</small>
        </div>
        <div>
          <span>
            <ShieldCheck />
          </span>
          <strong>{analyzedPercent}%</strong>
          <small>Analyzed artifacts</small>
        </div>
      </section>

      <section className="content-shell listing-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Registry catalogue</span>
            <h2>
              {params.q
                ? `Results for “${params.q}”`
                : "Packages your team relies on"}
            </h2>
            <p>
              {searchResult.total} matching packages, ranked by quality and
              usage.
            </p>
          </div>
          <form className="sort-form">
            <PreservedFilters params={params} omit={["sort", "page"]} />
            <label>Sort by</label>
            <div>
              <select name="sort" defaultValue={params.sort ?? "relevance"}>
                <option value="relevance">Relevance</option>
                <option value="updated">Recently updated</option>
                <option value="downloads">Downloads</option>
                <option value="score">Pub points</option>
              </select>
              <ChevronDown size={15} />
            </div>
            <button type="submit">Apply</button>
          </form>
        </div>
        <div className="catalog-layout">
          <form className="filters">
            <input type="hidden" name="q" value={params.q ?? ""} />
            <input
              type="hidden"
              name="sort"
              value={params.sort ?? "relevance"}
            />
            <div className="filter-head">
              <strong>Filters</strong>
              <a href={params.q ? `/?q=${encodeURIComponent(params.q)}` : "/"}>
                Clear
              </a>
            </div>
            <Filter
              title="SDK"
              name="sdk"
              options={[
                { label: "Flutter", value: "flutter" },
                { label: "Dart", value: "dart" },
              ]}
              selected={sdk}
            />
            <Filter
              title="Platform"
              name="platform"
              options={[
                { label: "Android", value: "android" },
                { label: "iOS", value: "ios" },
                { label: "Web", value: "web" },
                { label: "Desktop", value: "desktop" },
              ]}
              selected={platform}
            />
            <Filter
              title="Quality"
              options={[
                {
                  label: "Has preview",
                  name: "hasPreview",
                  value: "true",
                  checked: params.hasPreview === "true",
                },
                {
                  label: "Verified publisher",
                  name: "verifiedPublisher",
                  value: "true",
                  checked: params.verifiedPublisher === "true",
                },
                {
                  label: "140+ points",
                  name: "minScore",
                  value: "140",
                  checked: params.minScore === "140",
                },
              ]}
            />
            <button className="filter-apply" type="submit">
              Apply filters
            </button>
          </form>
          <div>
            <div className="package-list">
              {items.map((item) => (
                <PackageCard item={item} key={item.name} />
              ))}
              {items.length === 0 && (
                <div className="empty-results">
                  <Search />
                  <h3>No matching packages</h3>
                  <p>Try a broader package name, topic, or publisher.</p>
                </div>
              )}
            </div>
            {searchResult.total > searchResult.limit && (
              <nav className="pagination" aria-label="Package results pages">
                {page > 1 ? (
                  <a href={searchHref(params, page - 1)}>← Previous</a>
                ) : (
                  <span />
                )}
                <span>
                  Page {Math.min(page, totalPages)} / {totalPages}
                </span>
                {page < totalPages ? (
                  <a href={searchHref(params, page + 1)}>Next →</a>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

type FilterOption = {
  label: string;
  value: string;
  name?: string;
  checked?: boolean;
};
function Filter({
  title,
  name,
  options,
  selected = [],
}: {
  title: string;
  name?: string;
  options: FilterOption[];
  selected?: string[];
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      {options.map((option) => (
        <label key={option.label}>
          <input
            type="checkbox"
            name={option.name ?? name}
            value={option.value}
            defaultChecked={option.checked ?? selected.includes(option.value)}
          />{" "}
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function PreservedFilters({
  params,
  omit = [],
}: {
  params: HomeSearchParams;
  omit?: (keyof HomeSearchParams)[];
}) {
  return (
    <>
      {Object.entries(params).flatMap(([name, raw]) =>
        omit.includes(name as keyof HomeSearchParams) || raw === undefined
          ? []
          : values(raw).map((value) => (
              <input
                key={`${name}-${value}`}
                type="hidden"
                name={name}
                value={value}
              />
            )),
      )}
    </>
  );
}

function searchHref(params: HomeSearchParams, page: number) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([name, raw]) => {
    if (name !== "page")
      values(raw).forEach((value) => query.append(name, value));
  });
  query.set("page", String(page));
  return `/?${query}`;
}
