import { FileExplorer } from "@/components/file-explorer";
import { PackageTabs } from "@/components/package-tabs";
import { getPackage } from "@/lib/api";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function FilesPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ version?: string }> }) {
  const { name } = await params; const { version } = await searchParams; const detail = await getPackage(name); if (!detail) notFound(); const selected = version ?? detail.package.latestVersion;
  return <main className="files-page"><div className="content-shell"><div className="breadcrumbs"><Link href="/">Packages</Link><span>/</span><Link href={`/packages/${name}`}>{name}</Link><span>/</span><strong>Files</strong></div><div className="files-heading"><div><span className="eyebrow">Historical explorer</span><h1>{name} <small>{selected}</small></h1><p>Inspect every source file without downloading the archive.</p></div><select defaultValue={selected}>{detail.versions.map((v) => <option key={v.version}>{v.version}</option>)}</select></div><PackageTabs name={name} active="files" /><FileExplorer files={detail.files} version={selected} /></div></main>;
}
