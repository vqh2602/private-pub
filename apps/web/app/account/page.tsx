"use client";

import {
  KeyRound,
  LoaderCircle,
  LogOut,
  PackageOpen,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type User = {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
};

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        setError("Không thể tải tài khoản.");
        setLoading(false);
        return;
      }
      setUser((await response.json()).user);
      setLoading(false);
    });
  }, [router]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("Mật khẩu mới phải khác mật khẩu hiện tại.");
      return;
    }
    setLoading(true);
    const response = await fetch("/api/auth/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (response.ok) {
      router.replace("/login?passwordChanged=true");
      return;
    }
    const payload = await response.json().catch(() => ({}));
    setError(payload.message ?? "Không thể đổi mật khẩu.");
    setLoading(false);
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
      <div className="content-shell compact-content account-page">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Tài khoản</span>
            <h1>{user?.username}</h1>
            <p>
              {roleLabel(user?.role)} · Quản lý mật khẩu và quyền truy cập CLI.
            </p>
          </div>
          <button className="secondary-button" onClick={logout}>
            <LogOut />
            Đăng xuất
          </button>
        </div>
        {user?.mustChangePassword && (
          <div className="default-credential-warning">
            <ShieldCheck />
            <span>
              Bạn đang dùng mật khẩu tạm thời. Hãy đổi mật khẩu trước khi thực
              hiện thao tác quản trị hoặc tạo token.
            </span>
          </div>
        )}
        <div className="account-layout">
          <form
            className="token-form account-password-form"
            onSubmit={changePassword}
          >
            <div>
              <span className="auth-icon">
                <KeyRound />
              </span>
              <span className="eyebrow">Bảo mật</span>
              <h2>Đổi mật khẩu</h2>
              <p>
                Phiên đăng nhập hiện tại sẽ kết thúc sau khi đổi thành công.
              </p>
            </div>
            <label>
              Mật khẩu hiện tại
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              Mật khẩu mới (tối thiểu 10 ký tự)
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={10}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Xác nhận mật khẩu mới
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={10}
                autoComplete="new-password"
                required
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={loading}>
              {loading ? <LoaderCircle className="spin" /> : <ShieldCheck />}
              {loading ? "Đang đổi…" : "Đổi mật khẩu"}
            </button>
          </form>
          <aside className="side-card account-access-card">
            <PackageOpen />
            <span className="eyebrow">Developer access</span>
            <h2>Personal access token</h2>
            <p>
              Tạo và thu hồi token dùng với <code>dart pub</code>, CI hoặc quy
              trình phát hành package.
            </p>
            <Link className="primary-button" href="/tokens">
              Quản lý token
            </Link>
          </aside>
        </div>
      </div>
    </main>
  );
}

function roleLabel(role?: string) {
  if (role === "super_admin") return "Quản trị viên cấp cao";
  if (role === "admin") return "Quản trị viên";
  return "Người dùng";
}
