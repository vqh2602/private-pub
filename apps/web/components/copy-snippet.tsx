"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopySnippet({
  children,
  copyLabel,
}: {
  children: string;
  copyLabel?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(children);
      else legacyCopy(children);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 1800);
  }

  const label =
    status === "copied"
      ? "Copied"
      : status === "failed"
        ? "Copy failed"
        : copyLabel;
  return (
    <div className="code-snippet">
      <code>{children}</code>
      <button
        type="button"
        aria-label={copyLabel ?? "Copy command"}
        title={label ?? "Copy"}
        onClick={copy}
      >
        {status === "copied" ? <Check size={16} /> : <Copy size={16} />}
        {label && <span aria-live="polite">{label}</span>}
      </button>
    </div>
  );
}

function legacyCopy(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy command was rejected.");
}
