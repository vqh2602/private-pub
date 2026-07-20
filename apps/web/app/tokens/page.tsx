"use client";
import { CopySnippet } from "@/components/copy-snippet";
import { Badge } from "@private-pub/ui";
import {
  KeyRound,
  LoaderCircle,
  LogOut,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type User = {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
};
type CreatedToken = {
  id: string;
  token: string;
  prefix: string;
  scopes: string[];
  expiresAt: string;
};
type Token = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
const developerScopes = [
  "packages:read",
  "packages:publish",
  "imports:write",
  "tokens:write",
];

export default function TokensPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("Local development");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [neverExpires, setNeverExpires] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [cliTab, setCliTab] = useState<"dart" | "flutter" | "fvm">("dart");
  const [apiUrl, setApiUrl] = useState("http://localhost:4000");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setApiUrl(
        process.env.NEXT_PUBLIC_API_URL ||
          `${window.location.protocol}//${window.location.hostname}:4000`
      );
    }
  }, []);

  const load = useCallback(async () => {
    const me = await fetch("/api/auth/me", { cache: "no-store" });
    if (me.status === 401) {
      router.replace("/login");
      return;
    }
    if (!me.ok) {
      setError("Không thể tải phiên đăng nhập.");
      setLoading(false);
      return;
    }
    const mePayload = await me.json();
    setUser(mePayload.user);
    const response = await fetch("/api/registry/tokens", { cache: "no-store" });
    if (response.ok) setTokens((await response.json()).items);
    setLoading(false);
  }, [router]);
  useEffect(() => {
    void load();
  }, [load]);

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const scopes =
        user?.role === "admin" || user?.role === "super_admin"
          ? [...developerScopes, "packages:admin"]
          : developerScopes;
      const response = await fetch("/api/registry/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          scopes,
          expiresInDays: neverExpires ? null : expiresInDays,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message ??
            payload.error ??
            `Token creation failed (${response.status}).`,
        );
      setCreated(payload);
      setFormOpen(false);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Token creation failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch("/api/auth/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (response.ok) {
      router.replace("/login");
      return;
    }
    const payload = await response.json();
    setError(payload.message ?? "Không thể đổi mật khẩu.");
    setLoading(false);
  }

  async function revoke(id: string) {
    if (
      !confirm(
        "Thu hồi token này? Ứng dụng đang sử dụng token sẽ mất quyền truy cập.",
      )
    )
      return;
    const response = await fetch(
      `/api/registry/tokens/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    if (response.ok) await load();
    else setError("Không thể thu hồi token.");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (loading && !user)
    return (
      <main className="auth-page">
        <LoaderCircle className="spin" />
      </main>
    );
  return (
    <main className="subpage">
      <div className="content-shell compact-content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Developer access · {user?.username}</span>
            <h1>Personal access tokens</h1>
            <p>Mỗi token được lưu và quản lý theo tài khoản đang đăng nhập.</p>
          </div>
          <div className="heading-actions">
            <button
              className="primary-button"
              disabled={user?.mustChangePassword}
              onClick={() => setFormOpen((value) => !value)}
            >
              {formOpen ? <X /> : <Plus />}
              {formOpen ? "Cancel" : "Create token"}
            </button>
            <button className="secondary-button" onClick={logout}>
              <LogOut />
              Đăng xuất
            </button>
          </div>
        </div>
        {user?.mustChangePassword && (
          <form
            className="token-form password-change"
            onSubmit={changePassword}
          >
            <div>
              <ShieldAlert />
              <span className="eyebrow">Bắt buộc bảo mật</span>
              <h2>Đổi mật khẩu mặc định</h2>
              <p>
                Bạn phải đổi mật khẩu <code>admin</code> trước khi tạo hoặc quản
                lý token. Sau khi đổi, hãy đăng nhập lại.
              </p>
            </div>
            <label>
              Mật khẩu hiện tại
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <label>
              Mật khẩu mới (tối thiểu 10 ký tự)
              <input
                type="password"
                minLength={10}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={loading}>
              <ShieldCheck />
              Đổi mật khẩu
            </button>
          </form>
        )}
        {formOpen && !user?.mustChangePassword && (
          <form className="token-form" onSubmit={createToken}>
            <div>
              <span className="eyebrow">Account-owned PAT</span>
              <h2>New token</h2>
              <p>
                Token mới sẽ thuộc tài khoản <strong>{user?.username}</strong>.
              </p>
            </div>
            <div className="form-grid">
              <label>
                Token name
                <input
                  value={name}
                  minLength={2}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label>
                Expires in days
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  disabled={neverExpires}
                  onChange={(event) =>
                    setExpiresInDays(Number(event.target.value))
                  }
                  required={!neverExpires}
                />
              </label>
            </div>
            <label className="expiry-toggle">
              <input
                type="checkbox"
                checked={neverExpires}
                onChange={(event) => setNeverExpires(event.target.checked)}
              />
              Không hết hạn <small>Chỉ thu hồi khi bạn tự revoke token.</small>
            </label>
            <div className="token-scope-list">
              <small>Scopes</small>
              {[
                ...developerScopes,
                ...(user?.role === "admin" || user?.role === "super_admin"
                  ? ["packages:admin"]
                  : []),
              ].map((scope) => (
                <Badge key={scope}>{scope}</Badge>
              ))}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? <LoaderCircle className="spin" /> : <ShieldCheck />}
              {loading ? "Creating…" : "Create secure token"}
            </button>
          </form>
        )}
        {created && (
          <div className="token-created">
            <ShieldCheck />
            <div>
              <strong>Token created — copy the full value now</strong>
              <p>Giá trị đầy đủ chỉ hiển thị một lần.</p>
              <CopySnippet copyLabel="Copy full token">
                {created.token}
              </CopySnippet>
            </div>
          </div>
        )}
        {!user?.mustChangePassword && (
          <section className="table-card">
            <div className="table-title">
              <div>
                <span className="eyebrow">{user?.username}</span>
                <h2>Previously created tokens</h2>
              </div>
              <KeyRound />
            </div>
            {tokens.length === 0 ? (
              <div className="token-security-note">
                <p>Chưa có token nào cho tài khoản này.</p>
              </div>
            ) : (
              tokens.map((token) => (
                <div className="token-row" key={token.id}>
                  <div className="token-icon">
                    <KeyRound />
                  </div>
                  <div>
                    <strong>{token.name}</strong>
                    <p>
                      {token.prefix}•••• · tạo{" "}
                      {new Date(token.createdAt).toLocaleDateString("vi-VN")}
                      {token.lastUsedAt
                        ? ` · dùng gần nhất ${new Date(token.lastUsedAt).toLocaleDateString("vi-VN")}`
                        : ""}
                    </p>
                  </div>
                  <span>
                    {token.revokedAt
                      ? "Đã thu hồi"
                      : token.expiresAt
                        ? `Hết hạn ${new Date(token.expiresAt).toLocaleDateString("vi-VN")}`
                        : "Không hết hạn"}
                  </span>
                  <button
                    disabled={Boolean(token.revokedAt)}
                    onClick={() => revoke(token.id)}
                    aria-label={`Thu hồi ${token.name}`}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))
            )}
          </section>
        )}
        <section className="cli-setup">
          <span className="eyebrow">CLI configuration</span>
          <h2>Cấu hình Dart & Flutter CLI</h2>
          <p style={{ marginBottom: "16px" }}>
            Chọn công cụ bạn đang sử dụng để xem hướng dẫn cấu hình chi tiết:
          </p>

          <div className="cli-tabs">
            <button
              type="button"
              className={`cli-tab-btn ${cliTab === "dart" ? "active" : ""}`}
              onClick={() => setCliTab("dart")}
            >
              Dart CLI
            </button>
            <button
              type="button"
              className={`cli-tab-btn ${cliTab === "flutter" ? "active" : ""}`}
              onClick={() => setCliTab("flutter")}
            >
              Flutter CLI
            </button>
            <button
              type="button"
              className={`cli-tab-btn ${cliTab === "fvm" ? "active" : ""}`}
              onClick={() => setCliTab("fvm")}
            >
              FVM (Flutter)
            </button>
          </div>

          <p style={{ marginTop: "12px", fontSize: "14px", color: "var(--muted)" }}>
            Chạy lệnh dưới đây rồi dán token truy cập khi được hỏi <code>Enter secret token:</code> (Không chạy token trực tiếp trong lệnh shell).
          </p>

          {cliTab === "dart" && (
            <>
              <CopySnippet>
                {`dart pub token add ${apiUrl}`}
              </CopySnippet>
              <CopySnippet>dart pub get</CopySnippet>
            </>
          )}

          {cliTab === "flutter" && (
            <>
              <CopySnippet>
                {`flutter pub token add ${apiUrl}`}
              </CopySnippet>
              <CopySnippet>flutter pub get</CopySnippet>
            </>
          )}

          {cliTab === "fvm" && (
            <>
              <CopySnippet>
                {`fvm dart pub token add ${apiUrl}`}
              </CopySnippet>
              <CopySnippet>fvm dart pub get</CopySnippet>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
