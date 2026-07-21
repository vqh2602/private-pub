import Link from "next/link";
const tabs = ["Readme", "Changelog", "Installing", "Versions", "Scores", "Files", "Admin"];
export function PackageTabs({ name, active }: { name: string; active: string }) {
  return <div className="tabs" role="tablist">{tabs.map((tab) => <Link key={tab} className={active === tab.toLowerCase() ? "active" : ""} href={tab === "Files" ? `/packages/${name}/files` : `/packages/${name}?tab=${tab.toLowerCase()}`}>{tab}</Link>)}</div>;
}
