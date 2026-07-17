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
            <Service icon={<Server />} name="Registry API" detail="p95 42 ms" />
            <Service
              icon={<Database />}
              name="PostgreSQL"
              detail="12 active connections"
            />
            <Service
              icon={<HardDrive />}
              name="Object storage"
              detail="99.99% available"
            />
            <Service
              icon={<Boxes />}
              name="Analysis worker"
              detail="4 runners ready"
            />
          </section>
          <section className="panel-card">
            <div className="panel-title">
              <div>
                <span className="eyebrow">Audit trail</span>
                <strong>Recent activity</strong>
              </div>
            </div>
            <Audit
              icon={<CheckCircle2 />}
              title="aurora_ui 2.3.1 published"
              meta="Vuong Huy · 14 minutes ago"
            />
            <Audit
              icon={<ShieldCheck />}
              title="PAT created"
              meta="CI release bot · 32 minutes ago"
            />
            <Audit
              icon={<Clock3 />}
              title="archive 4.0.9 import queued"
              meta="Platform admin · 1 hour ago"
            />
            <Audit
              icon={<AlertTriangle />}
              title="legacy_networking discontinued"
              meta="Package admin · yesterday"
            />
          </section>
        </div>
        <UserManagement />
      </div>
    </main>
  );
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
