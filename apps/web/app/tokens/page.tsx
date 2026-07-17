"use client";
import { CopySnippet } from "@/components/copy-snippet";
import { Badge } from "@private-pub/ui";
import { KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

export default function TokensPage() {
  const [created, setCreated] = useState(false);
  return <main className="subpage"><div className="content-shell compact-content"><div className="page-heading"><div><span className="eyebrow">Developer access</span><h1>Personal access tokens</h1><p>Authenticate Dart CLI and CI without storing your identity-provider session.</p></div><button className="primary-button" onClick={() => setCreated(true)}><Plus />Create token</button></div>{created && <div className="token-created"><ShieldCheck /><div><strong>Token created — copy it now</strong><p>For security, it will not be shown again.</p><CopySnippet>pp_demo_M5c6tX2yvB4Qn89zL0</CopySnippet></div></div>}<section className="table-card"><div className="table-title"><div><span className="eyebrow">Active credentials</span><h2>Your tokens</h2></div><Badge>2 active</Badge></div><div className="token-row"><span className="token-icon"><KeyRound /></span><div><strong>Local development</strong><p><code>pp_4Rj2…</code> · packages:read, packages:publish</p></div><span>Expires in 48 days</span><button aria-label="Revoke token"><Trash2 /></button></div><div className="token-row"><span className="token-icon"><KeyRound /></span><div><strong>Release automation</strong><p><code>pp_8Pb7…</code> · packages:publish</p></div><span>Expires in 81 days</span><button aria-label="Revoke token"><Trash2 /></button></div></section><section className="cli-setup"><span className="eyebrow">CLI quick start</span><h2>Connect dart pub</h2><p>Add the registry token, then point your package at the private hosted URL.</p><CopySnippet>dart pub token add http://localhost:4000</CopySnippet><CopySnippet>dart pub get</CopySnippet></section></div></main>;
}
