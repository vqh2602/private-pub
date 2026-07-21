import { CopySnippet } from "@/components/copy-snippet";
import { MarkdownPreview } from "@/components/markdown-preview";
import { PackageTabs } from "@/components/package-tabs";
import { PackageAdminForm } from "@/components/package-admin-form";
import { getPackage } from "@/lib/api";
import { Badge, StatCard } from "@private-pub/ui";
import type { PackageVersion, ReleaseChannel } from "@private-pub/contracts";
import {
  Box,
  Braces,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  GitBranch,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  return { title: name };
}

export default async function PackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { name } = await params;
  const { tab = "readme" } = await searchParams;
  const detail = await getPackage(name, {
    includeVersions: tab === "versions",
    includeFiles: false,
  });
  if (!detail) notFound();
  const apiUrl = (
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
  ).replace(/\/$/, "");
  const repositoryUrl = externalUrl(detail.latestVersion.pubspec.repository);
  const documentationUrl =
    externalUrl(detail.latestVersion.pubspec.documentation) ??
    externalUrl(detail.latestVersion.pubspec.homepage);
  return (
    <main className="package-page">
      <section className="package-hero">
        <div className="content-shell">
          <div className="breadcrumbs">
            <Link href="/">Packages</Link>
            <span>/</span>
            <strong>{name}</strong>
          </div>
          <div className="package-title-row">
            <div className="big-package-icon">
              <Box />
            </div>
            <div className="package-title">
              <div>
                <h1>{name}</h1>
                <Badge tone="blue">v{detail.package.latestVersion}</Badge>
                <ChannelBadge channel={detail.latestVersion.releaseChannel} />
              </div>
              <p>{detail.package.description}</p>
              <div className="package-meta">
                <span>
                  <CheckCircle2 size={15} />
                  Published by{" "}
                  <strong>
                    {detail.latestVersion.publishedBy ?? "Unknown"}
                  </strong>
                </span>
                <span>
                  Publisher{" "}
                  <Link href={`/publishers/${detail.package.publisherId}`}>
                    {detail.package.publisherId}
                  </Link>
                </span>
                <span>
                  <Clock3 size={15} />
                  Updated 1 day ago
                </span>
              </div>
            </div>
            <div className="package-actions">
              <PackageLink
                href={repositoryUrl}
                icon={<GitBranch size={16} />}
                label="Repository"
              />
              <PackageLink
                href={documentationUrl}
                icon={<ExternalLink size={16} />}
                label="Documentation"
              />
            </div>
          </div>
        </div>
      </section>
      <div className="content-shell">
        <PackageTabs name={name} active={tab} />
        <div className="detail-layout">
          <section className="detail-main">
            {tab === "versions" ? (
              <Versions detail={detail} name={name} />
            ) : tab === "scores" ? (
              <Scores detail={detail} />
            ) : tab === "admin" ? (
              <PackageAdminForm name={name} detail={detail} />
            ) : tab === "changelog" ? (
              <Document title="Changelog" text={detail.changelog} />
            ) : tab === "installing" ? (
              <Installing
                name={name}
                version={detail.package.latestVersion}
                apiUrl={apiUrl}
              />
            ) : (
              <div className="readme-stack">
                <Document title="About this package" text={detail.readme} />
              </div>
            )}
          </section>
          <aside className="package-sidebar">
            <div className="side-card">
              <span className="eyebrow">Install</span>
              <h3>Add to pubspec.yaml</h3>
              <CopySnippet>{`${name}: ^${detail.package.latestVersion}`}</CopySnippet>
              <a href="/tokens">Configure private registry →</a>
            </div>
            <div className="side-card requirements-card">
              <span className="eyebrow">Requirements</span>
              <div className="requirement-row">
                <span>
                  <Braces size={16} />
                </span>
                <div>
                  <small>Dart SDK minimum</small>
                  <strong>{detail.requirements.dartSdkMinimum}</strong>
                  <code>{detail.requirements.dartSdkConstraint}</code>
                </div>
              </div>
              {detail.requirements.flutterMinimum && (
                <div className="requirement-row">
                  <span>
                    <Layers3 size={16} />
                  </span>
                  <div>
                    <small>Flutter minimum</small>
                    <strong>{detail.requirements.flutterMinimum}</strong>
                    <code>{detail.requirements.flutterConstraint}</code>
                  </div>
                </div>
              )}
            </div>
            <div className="side-card">
              <span className="eyebrow">Package metadata</span>
              <dl>
                <dt>License</dt>
                <dd>MIT</dd>
                <dt>SDK</dt>
                <dd>
                  {detail.requirements.flutterMinimum ? "Flutter" : "Dart"}
                </dd>
                <dt>Platforms</dt>
                <dd>{detail.latestVersion.platforms.join(", ")}</dd>
                <dt>Archive</dt>
                <dd>{detail.latestVersion.archiveSha256.slice(0, 10)}…</dd>
              </dl>
            </div>
            <Dependencies dependencies={detail.dependencies} />
            <div className="side-card security">
              <ShieldCheck />
              <div>
                <strong>Supply-chain verified</strong>
                <p>Archive integrity checked and analysis completed.</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Document({ title, text }: { title: string; text: string }) {
  return (
    <article className="readme">
      <span className="eyebrow">Documentation</span>
      <h2>{title}</h2>
      <MarkdownPreview content={text} />
    </article>
  );
}
function PackageLink({
  href,
  icon,
  label,
}: {
  href: string | null;
  icon: ReactNode;
  label: string;
}) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {icon}
      {label}
    </a>
  ) : (
    <span
      className="disabled"
      title={`${label} URL is not declared in pubspec.yaml`}
    >
      {icon}
      {label}
    </span>
  );
}
function externalUrl(value: unknown) {
  return typeof value === "string" && /^https?:\/\//i.test(value)
    ? value
    : null;
}
function Dependencies({
  dependencies,
}: {
  dependencies: NonNullable<
    Awaited<ReturnType<typeof getPackage>>
  >["dependencies"];
}) {
  if (dependencies.length === 0) return null;
  const runtime = dependencies.filter(
    (dependency) => dependency.scope === "dependencies",
  );
  const development = dependencies.filter(
    (dependency) => dependency.scope === "dev_dependencies",
  );
  return (
    <div className="side-card dependencies-card">
      <span className="eyebrow">Dependencies</span>
      {runtime.length > 0 && (
        <DependencyGroup title="Runtime dependencies" items={runtime} />
      )}
      {development.length > 0 && (
        <DependencyGroup title="Development dependencies" items={development} />
      )}
    </div>
  );
}
function DependencyGroup({
  title,
  items,
}: {
  title: string;
  items: NonNullable<Awaited<ReturnType<typeof getPackage>>>["dependencies"];
}) {
  return (
    <div className="dependency-group">
      <h3>{title}</h3>
      {items.map((dependency) => (
        <div
          className="dependency-row"
          key={`${dependency.scope}-${dependency.name}`}
        >
          <DependencyLink dependency={dependency} />
          <code>{dependency.constraint}</code>
        </div>
      ))}
    </div>
  );
}
function DependencyLink({
  dependency,
}: {
  dependency: NonNullable<
    Awaited<ReturnType<typeof getPackage>>
  >["dependencies"][number];
}) {
  const label =
    dependency.registry === "private"
      ? "Private registry"
      : dependency.registry === "pubdev"
        ? "pub.dev"
        : dependency.registry === "sdk"
          ? "Flutter SDK"
          : dependency.source;
  const content = (
    <>
      <span className="dependency-icon">
        <Layers3 size={15} />
      </span>
      <span className="dependency-name">
        <strong>{dependency.name}</strong>
        <small>{label}</small>
      </span>
      <ExternalLink size={13} />
    </>
  );
  if (dependency.registry === "private")
    return (
      <Link className="dependency-link" href={`/packages/${dependency.name}`}>
        {content}
      </Link>
    );
  if (dependency.registry === "pubdev")
    return (
      <a
        className="dependency-link"
        href={`https://pub.dev/packages/${dependency.name}`}
        target="_blank"
        rel="noreferrer"
      >
        {content}
      </a>
    );
  if (dependency.registry === "sdk")
    return (
      <a
        className="dependency-link"
        href="https://api.flutter.dev/"
        target="_blank"
        rel="noreferrer"
      >
        {content}
      </a>
    );
  return <span className="dependency-link disabled">{content}</span>;
}
const channelOrder: ReleaseChannel[] = [
  "stable",
  "rc",
  "beta",
  "alpha",
  "dev",
  "prerelease",
];
const channelLabels: Record<ReleaseChannel, string> = {
  stable: "Stable",
  rc: "Release candidate",
  beta: "Beta",
  alpha: "Alpha",
  dev: "Development",
  prerelease: "Other prerelease",
};

function ChannelBadge({ channel }: { channel: ReleaseChannel }) {
  const tone =
    channel === "stable"
      ? "green"
      : channel === "rc"
        ? "blue"
        : channel === "beta" || channel === "alpha"
          ? "amber"
          : "neutral";
  return <Badge tone={tone}>{channelLabels[channel]}</Badge>;
}

function Versions({
  detail,
  name,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getPackage>>>;
  name: string;
}) {
  const groups = channelOrder
    .map((channel) => ({
      channel,
      versions: detail.versions.filter(
        (version) => version.releaseChannel === channel,
      ),
    }))
    .filter((group) => group.versions.length > 0);
  return (
    <div className="table-card versions-card">
      <div className="table-title">
        <div>
          <span className="eyebrow">Release history</span>
          <h2>Versions</h2>
        </div>
        <Badge>{detail.versions.length} releases</Badge>
      </div>
      {groups.map((group) => (
        <section className="release-group" key={group.channel}>
          <div className="release-group-title">
            <div>
              <ChannelBadge channel={group.channel} />
              <span>
                {group.versions.length}{" "}
                {group.versions.length === 1 ? "version" : "versions"}
              </span>
            </div>
            {group.channel === "stable" && (
              <small>Used as the default version by pub clients</small>
            )}
          </div>
          <VersionTable versions={group.versions} name={name} />
        </section>
      ))}
    </div>
  );
}

function VersionTable({
  versions,
  name,
}: {
  versions: PackageVersion[];
  name: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Published</th>
            <th>Published by</th>
            <th>Min SDK</th>
            <th>Source</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={version.version}>
              <td>
                <strong>{version.version}</strong>
                {version.retractedAt && <Badge tone="red">Retracted</Badge>}
              </td>
              <td>{new Date(version.publishedAt).toLocaleDateString()}</td>
              <td>{version.publishedBy ?? "Unknown"}</td>
              <td>{version.sdk.dart.split(" ")[0]}</td>
              <td>
                {version.sourceType === "native"
                  ? "Native publish"
                  : "pub.dev import"}
              </td>
              <td>
                <Link
                  href={`/packages/${name}/files?version=${version.version}`}
                >
                  Browse files
                </Link>{" "}
                <a
                  href={`/api/registry/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version.version)}/archive`}
                  title={`Download ${name} ${version.version} archive (.tar.gz)`}
                  aria-label={`Download ${name} ${version.version} archive (.tar.gz)`}
                >
                  <Download size={14} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Scores({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getPackage>>>;
}) {
  return (
    <div>
      <div className="score-grid">
        <StatCard
          label="Pub points"
          value={`${detail.score.grantedPoints}/${detail.score.maxPoints}`}
          detail="Automated quality checks"
          accent="blue"
        />
        <StatCard
          label="Popularity"
          value={`${Math.round(detail.score.popularityScore * 100)}%`}
          detail="Internal usage signal"
          accent="purple"
        />
        <StatCard
          label="Maintenance"
          value={`${Math.round(detail.score.maintenanceScore * 100)}%`}
          detail="Release and dependency health"
          accent="green"
        />
      </div>
      <div className="score-breakdown">
        <div className="table-title">
          <div>
            <span className="eyebrow">Detailed analysis</span>
            <h2>Score breakdown</h2>
          </div>
        </div>
        {detail.score.breakdown.map((item) => (
          <div className="score-item" key={item.label}>
            <div className="score-row">
              <span className={`score-status ${item.status}`} />
              <div>
                <strong>{item.label}</strong>
                <small>
                  {item.points === item.max
                    ? "All checks passed"
                    : `${item.max - item.points} points not awarded`}
                </small>
              </div>
              <div className="score-bar">
                <i style={{ width: `${(item.points / item.max) * 100}%` }} />
              </div>
              <b>
                {item.points}/{item.max}
              </b>
            </div>
            {item.points < item.max &&
              item.details &&
              item.details.length > 0 && (
                <ul className="score-reasons">
                  {item.details.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Installing({
  name,
  version,
  apiUrl,
}: {
  name: string;
  version: string;
  apiUrl: string;
}) {
  return (
    <article className="readme installing-guide">
      <span className="eyebrow">Installing</span>
      <h2>Use this package as a library</h2>

      <div className="install-section">
        <p>Run this command:</p>
        <CopySnippet>
          {`flutter pub add ${name} --hosted-url ${apiUrl}`}
        </CopySnippet>
      </div>

      <div className="install-section">
        <p>Or, with the ppub CLI:</p>
        <CopySnippet>{`ppub add ${name}`}</CopySnippet>
        <p className="cli-hint">
          Don't have the CLI? See the{" "}
          <Link href="/tokens">installation guide</Link>.
        </p>
      </div>

      <div className="install-section">
        <p>
          Or add it manually to your <code>pubspec.yaml</code>:
        </p>
        <CopySnippet>
          {`dependencies:
  ${name}:
    hosted: ${apiUrl}
    version: ^${version}`}
        </CopySnippet>
        <p className="post-install-hint">
          Then run <code>flutter pub get</code>.
        </p>
      </div>

      <h2>Import it</h2>

      <div className="install-section">
        <p>Now in your Dart code, you can use:</p>
        <CopySnippet>{`import 'package:${name}/${name}.dart';`}</CopySnippet>
      </div>
    </article>
  );
}
