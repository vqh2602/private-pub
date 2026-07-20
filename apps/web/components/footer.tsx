"use client";

import { useLanguage } from "@/components/language-provider";
import type { SystemInfo } from "@/lib/api";

export function Footer({ systemInfo }: { systemInfo: SystemInfo }) {
  const { t } = useLanguage();
  return (
    <footer>
      <div className="footer-brand">
        <strong>Constellation Registry</strong>
        <span>{t.footerDescription}</span>
        <div className="footer-versions" aria-label="System versions">
          <span>Web v{systemInfo.appVersion}</span>
          <span>FVM {systemInfo.fvmVersion ?? "unavailable"}</span>
          <span>Flutter {systemInfo.flutterVersion ?? "unavailable"}</span>
          <span>Dart {systemInfo.dartVersion ?? "unavailable"}</span>
        </div>
      </div>
      <nav>
        <a href="http://localhost:4000/docs">{t.apiDocs}</a>
        <a href="/admin">{t.systemStatus}</a>
        <a href="/tokens">{t.cliSetup}</a>
      </nav>
    </footer>
  );
}
