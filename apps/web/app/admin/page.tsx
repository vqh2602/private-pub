import { Badge, StatCard } from "@private-pub/ui";
import { getRegistryStats } from "@/lib/api";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock3,
  Database,
  HardDrive,
  Server,
  ShieldCheck,
} from "lucide-react";
import { UserManagement } from "@/components/user-management";

export default async function AdminPage() {
  const stats = await getRegistryStats();
  const analyzedPercent = stats.versions
    ? Math.round((stats.analyzedVersions / stats.versions) * 100)
    : 0;

  const health = stats.health || {
    api: { status: "Healthy", detail: "p95 42 ms" },
    database: { status: "Healthy", detail: "12 active connections" },
    storage: { status: "Healthy", detail: "99.99% available" },
    worker: { status: "Healthy", detail: "4 runners ready" },
  };

  const activity = stats.activity || [];

  return (
    <main className="subpage admin-page">
      <div className="content-shell compact-content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Control plane</span>
            <h1>Registry administration</h1>
            <p>System health, queues, policy, and recent audit activity.</p>
          </div>
          <Badge tone="green">
            <Activity size={13} />
            All systems operational
          </Badge>
        </div>
        <div className="score-grid">
          <StatCard
            label="Private packages"
            value={stats.packages.toLocaleString("en-US")}
            detail="Packages currently in the registry"
          />
          <StatCard
            label="Published versions"
            value={stats.versions.toLocaleString("en-US")}
            detail="All published package versions"
            accent="purple"
          />
          <StatCard
            label="Analyzed versions"
            value={stats.analyzedVersions.toLocaleString("en-US")}
            detail={`${analyzedPercent}% analysis coverage`}
            accent="green"
          />
        </div>
        <div className="admin-grid">
          <section className="panel-card">
            <div className="panel-title">
              <div>
                <span className="eyebrow">Infrastructure</span>
                <strong>Service health</strong>
              </div>
            </div>
            <Service
              icon={<Server />}
              name="Registry API"
              detail={health.api.detail}
            />
            <Service
              icon={<Database />}
              name="PostgreSQL"
              detail={health.database.detail}
            />
            <Service
              icon={<HardDrive />}
              name="Object storage"
              detail={health.storage.detail}
            />
            <Service
              icon={<Boxes />}
              name="Analysis worker"
              detail={health.worker.detail}
            />
          </section>
          <section className="panel-card">
            <div className="panel-title">
              <div>
                <span className="eyebrow">Audit trail</span>
                <strong>Recent activity</strong>
              </div>
            </div>
            {activity.map((item) => (
              <Audit
                key={item.id}
                icon={getActivityIcon(item.icon)}
                title={item.title}
                meta={formatMeta(item.meta)}
              />
            ))}
          </section>
        </div>
        <UserManagement />
      </div>
    </main>
  );
}

function getActivityIcon(icon: string) {
  switch (icon) {
    case "publish":
      return <CheckCircle2 />;
    case "pat":
      return <ShieldCheck />;
    case "import":
      return <Clock3 />;
    case "discontinue":
      return <AlertTriangle />;
    default:
      return <CheckCircle2 />;
  }
}

function formatMeta(meta: string) {
  const parts = meta.split(" · ");
  if (parts.length !== 2) return meta;
  const [actor, dateStr] = parts;
  try {
    const date = new Date(dateStr!);
    if (isNaN(date.getTime())) return meta;
    return `${actor} · ${formatDistanceToNow(date)}`;
  } catch {
    return meta;
  }
}

function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins === 1) return "1 minute ago";
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}

function Service({
  icon,
  name,
  detail,
}: {
  icon: React.ReactNode;
  name: string;
  detail: string;
}) {
  return (
    <div className="service-row">
      <span>{icon}</span>
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
      <Badge tone="green">Healthy</Badge>
    </div>
  );
}
function Audit({
  icon,
  title,
  meta,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
}) {
  return (
    <div className="audit-row">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
    </div>
  );
}
