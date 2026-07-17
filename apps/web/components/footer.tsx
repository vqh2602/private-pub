"use client";

import { useLanguage } from "@/components/language-provider";

export function Footer() {
  const { t } = useLanguage();
  return <footer><div><strong>Constellation Registry</strong><span>{t.footerDescription}</span></div><nav><a href="http://localhost:4000/docs">{t.apiDocs}</a><a href="/admin">{t.systemStatus}</a><a href="/tokens">{t.cliSetup}</a></nav></footer>;
}
