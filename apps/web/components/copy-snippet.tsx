"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopySnippet({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="code-snippet"><code>{children}</code><button aria-label="Copy command" onClick={async () => { await navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>;
}
