"use client";
import type { PackageFile } from "@private-pub/contracts";
import { Badge, EmptyState } from "@private-pub/ui";
import {
  ChevronRight,
  File,
  FileCode2,
  Folder,
  GitCompareArrows,
  PanelRightClose,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MarkdownPreview } from "./markdown-preview";

type Mode = "preview" | "code" | "raw" | "diff";
type FileTreeNode = {
  name: string;
  path: string;
  file?: PackageFile;
  children: FileTreeNode[];
};

export function FileExplorer({
  files,
  version,
  packageName,
}: {
  files: PackageFile[];
  version: string;
  packageName: string;
}) {
  const initial =
    files.find((file) => file.path === "README.md") ??
    files.find((file) => file.type === "file")!;
  const [current, setCurrent] = useState(initial);
  const [mode, setMode] = useState<Mode>("preview");
  const [loadingFile, setLoadingFile] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  const tree = useMemo(() => buildFileTree(files), [files]);

  useEffect(() => {
    if (
      !current ||
      current.content !== undefined ||
      current.preview === "unsupported" ||
      current.type !== "file"
    ) {
      setLoadingFile(false);
      return;
    }
    const controller = new AbortController();
    setLoadingFile(true);
    const encodedPath = current.path
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    fetch(
      `/api/registry/packages/${encodeURIComponent(packageName)}/versions/${encodeURIComponent(version)}/files/${encodedPath}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`File request failed: ${response.status}`);
        return response.json() as Promise<PackageFile>;
      })
      .then((loaded) =>
        setCurrent((selected) =>
          selected?.path === loaded.path
            ? loaded.content === undefined
              ? { ...loaded, preview: "unsupported" }
              : loaded
            : selected,
        ),
      )
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          console.error(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFile(false);
      });
    return () => controller.abort();
  }, [current, packageName, version]);

  function toggleFolder(path: string) {
    setExpandedFolders((openFolders) => {
      const next = new Set(openFolders);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="explorer-grid">
      <aside className="file-tree panel-card">
        <div className="panel-title">
          <div>
            <strong>Files</strong>
            <small>
              {packageName} {version}
            </small>
          </div>
          <Badge>{files.length} entries</Badge>
        </div>
        <div className="tree-list">
          {tree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              currentPath={current?.path}
              expandedFolders={expandedFolders}
              onToggleFolder={toggleFolder}
              onSelectFile={setCurrent}
            />
          ))}
        </div>
      </aside>
      <main className="viewer panel-card">
        <div className="viewer-head">
          <div>
            <strong>{current?.path}</strong>
            <small>{current?.language ?? "binary"}</small>
          </div>
          <Badge tone="green">Pinned {version}</Badge>
        </div>
        <div className="viewer-tabs">
          {(["preview", "code", "raw", "diff"] as Mode[]).map((item) => (
            <button
              key={item}
              onClick={() => setMode(item)}
              className={mode === item ? "active" : ""}
            >
              {item === "diff" && <GitCompareArrows size={14} />}
              {item[0]!.toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <div className="viewer-content">
          {current ? (
            <FileContent file={current} mode={mode} loading={loadingFile} />
          ) : (
            <EmptyState
              title="No file selected"
              description="Choose a file from the tree."
            />
          )}
        </div>
      </main>
      <aside className="file-meta panel-card">
        <div className="panel-title">
          <strong>Metadata</strong>
          <PanelRightClose size={17} />
        </div>
        <dl>
          <dt>Path</dt>
          <dd>{current?.path}</dd>
          <dt>Language</dt>
          <dd>{current?.language ?? "—"}</dd>
          <dt>Size</dt>
          <dd>
            {current?.size ? `${(current.size / 1024).toFixed(1)} KB` : "—"}
          </dd>
          <dt>Preview</dt>
          <dd>{current?.preview ?? "unsupported"}</dd>
          <dt>Status</dt>
          <dd>
            <Badge tone="green">Ready</Badge>
          </dd>
          <dt>SHA256</dt>
          <dd className="hash">a1b24ff09...e12a</dd>
        </dl>
      </aside>
    </div>
  );
}

function FileTreeItem({
  node,
  currentPath,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
}: {
  node: FileTreeNode;
  currentPath: string | undefined;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (file: PackageFile) => void;
}) {
  if (node.file) {
    return (
      <button
        className={currentPath === node.file.path ? "active" : ""}
        onClick={() => onSelectFile(node.file!)}
      >
        {node.file.language === "dart" ? (
          <FileCode2 size={15} />
        ) : (
          <File size={15} />
        )}
        <span>{node.name}</span>
      </button>
    );
  }

  const expanded = expandedFolders.has(node.path);
  return (
    <div className="tree-branch">
      <button
        className="tree-folder"
        type="button"
        onClick={() => onToggleFolder(node.path)}
        aria-expanded={expanded}
      >
        <ChevronRight className={expanded ? "expanded" : ""} size={14} />
        <Folder size={15} />
        <span>{node.name}</span>
      </button>
      {expanded && (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              currentPath={currentPath}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function buildFileTree(files: PackageFile[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", children: [] };

  for (const file of files) {
    const parts = file.path.replace(/\/$/, "").split("/").filter(Boolean);
    let parent = root;
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let node = parent.children.find((child) => child.name === name);
      if (!node) {
        node = { name, path, children: [] };
        parent.children.push(node);
      }
      if (index === parts.length - 1 && file.type === "file") node.file = file;
      parent = node;
    });
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort(
      (a, b) =>
        Number(Boolean(a.file)) - Number(Boolean(b.file)) ||
        a.name.localeCompare(b.name),
    );
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);
  return root.children;
}

function FileContent({
  file,
  mode,
  loading,
}: {
  file: PackageFile;
  mode: Mode;
  loading: boolean;
}) {
  if (loading)
    return (
      <EmptyState
        title="Loading preview"
        description="Fetching the selected file content."
      />
    );
  if (mode === "diff")
    return (
      <div className="diff">
        <div className="diff-head">Comparing 2.3.0 → 2.3.1</div>
        <pre>
          <span className="removed">- color: oldPrimary</span>
          {"\n"}
          <span className="added">+ color: auroraPrimary</span>
          {"\n"}
          {file.content ?? "Binary content cannot be diffed."}
        </pre>
      </div>
    );
  if (!file.content)
    return (
      <EmptyState
        title="Preview unavailable"
        description="Download the raw file to inspect this binary artifact."
      />
    );
  if (mode === "preview" && file.preview === "markdown") {
    return (
      <article className="markdown-preview">
        <MarkdownPreview content={file.content} />
      </article>
    );
  }
  if (mode === "preview" && file.preview === "structured")
    return (
      <div className="structured-preview">
        <div className="summary-tile">
          <span>Package</span>
          <strong>aurora_ui</strong>
        </div>
        <div className="summary-tile">
          <span>Version</span>
          <strong>2.3.1</strong>
        </div>
        <pre>{file.content}</pre>
      </div>
    );
  return (
    <pre className="source-code">
      <code>{file.content}</code>
    </pre>
  );
}
