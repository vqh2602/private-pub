"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function RegistryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="subpage">
      <div className="content-shell compact-content">
        <section className="registry-error" role="alert">
          <AlertTriangle />
          <div>
            <span className="eyebrow">Registry unavailable</span>
            <h1>Không thể kết nối tới Registry API</h1>
            <p>
              Hãy bảo đảm API đang chạy và database đã được migrate, sau đó thử
              lại.
            </p>
            <code>pnpm dev</code>
            <button type="button" onClick={reset}>
              <RefreshCw size={16} /> Thử lại
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
