import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props} />;
}

export function Badge({
  children,
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "amber" | "red";
}) {
  return (
    <span className={`badge badge-${tone} ${className}`} {...props}>
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  detail,
  accent = "blue",
}: {
  label: string;
  value: string;
  detail: string;
  accent?: string;
}) {
  return (
    <div className="stat-card">
      <span className={`stat-orb stat-${accent}`} />
      <div>
        <div className="eyebrow">{label}</div>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
