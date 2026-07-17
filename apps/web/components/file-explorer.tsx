"use client";
import type { PackageFile } from "@private-pub/contracts";
import { Badge, EmptyState } from "@private-pub/ui";
import { ChevronRight, File, FileCode2, Folder, GitCompareArrows, PanelRightClose } from "lucide-react";
import { useMemo, useState } from "react";

type Mode = "preview" | "code" | "raw" | "diff";
export function FileExplorer({ files, version }: { files: PackageFile[]; version: string }) {
  const initial = files.find((file) => file.path === "README.md") ?? files.find((file) => file.type === "file")!;
  const [current, setCurrent] = useState(initial);
  const [mode, setMode] = useState<Mode>("preview");
  const folders = useMemo(() => files.filter((f) => f.type === "dir"), [files]);
  return <div className="explorer-grid">
    <aside className="file-tree panel-card">
      <div className="panel-title"><div><strong>Files</strong><small>aurora_ui {version}</small></div><Badge>{files.length} entries</Badge></div>
      <div className="tree-list">
        {folders.map((folder) => <div className="tree-folder" key={folder.path}><ChevronRight size={14} /><Folder size={15} />{folder.path}</div>)}
        {files.filter((f) => f.type === "file").map((file) => <button key={file.path} className={current?.path === file.path ? "active" : ""} onClick={() => setCurrent(file)}>{file.language === "dart" ? <FileCode2 size={15} /> : <File size={15} />}<span>{file.path}</span></button>)}
      </div>
    </aside>
    <main className="viewer panel-card">
      <div className="viewer-head"><div><strong>{current?.path}</strong><small>{current?.language ?? "binary"}</small></div><Badge tone="green">Pinned {version}</Badge></div>
      <div className="viewer-tabs">{(["preview", "code", "raw", "diff"] as Mode[]).map((item) => <button key={item} onClick={() => setMode(item)} className={mode === item ? "active" : ""}>{item === "diff" && <GitCompareArrows size={14} />}{item[0]!.toUpperCase() + item.slice(1)}</button>)}</div>
      <div className="viewer-content">{current ? <FileContent file={current} mode={mode} /> : <EmptyState title="No file selected" description="Choose a file from the tree." />}</div>
    </main>
    <aside className="file-meta panel-card">
      <div className="panel-title"><strong>Metadata</strong><PanelRightClose size={17} /></div>
      <dl><dt>Path</dt><dd>{current?.path}</dd><dt>Language</dt><dd>{current?.language ?? "—"}</dd><dt>Size</dt><dd>{current?.size ? `${(current.size / 1024).toFixed(1)} KB` : "—"}</dd><dt>Preview</dt><dd>{current?.preview ?? "unsupported"}</dd><dt>Status</dt><dd><Badge tone="green">Ready</Badge></dd><dt>SHA256</dt><dd className="hash">a1b24ff09...e12a</dd></dl>
    </aside>
  </div>;
}

function FileContent({ file, mode }: { file: PackageFile; mode: Mode }) {
  if (mode === "diff") return <div className="diff"><div className="diff-head">Comparing 2.3.0 → 2.3.1</div><pre><span className="removed">- color: oldPrimary</span>{"\n"}<span className="added">+ color: auroraPrimary</span>{"\n"}{file.content ?? "Binary content cannot be diffed."}</pre></div>;
  if (!file.content) return <EmptyState title="Preview unavailable" description="Download the raw file to inspect this binary artifact." />;
  if (mode === "preview" && file.preview === "markdown") {
    const lines = file.content.split("\n");
    return <article className="markdown-preview">{lines.map((line, index) => line.startsWith("# ") ? <h1 key={index}>{line.slice(2)}</h1> : line.startsWith("## ") ? <h2 key={index}>{line.slice(3)}</h2> : line.startsWith("- ") ? <li key={index}>{line.slice(2)}</li> : line ? <p key={index}>{line}</p> : <br key={index} />)}</article>;
  }
  if (mode === "preview" && file.preview === "structured") return <div className="structured-preview"><div className="summary-tile"><span>Package</span><strong>aurora_ui</strong></div><div className="summary-tile"><span>Version</span><strong>2.3.1</strong></div><pre>{file.content}</pre></div>;
  return <pre className="source-code"><code>{file.content}</code></pre>;
}
