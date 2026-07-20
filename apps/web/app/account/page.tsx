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
import { useLanguage } from "@/components/language-provider";

type User = {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
};

export default function AccountPage() {
  const router = useRouter();
  const { locale } = useLanguage();
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
        setError(locale === "en" ? "Unable to load account." : "Không thể tải tài khoản.");
        setLoading(false);
        return;
      }
      setUser((await response.json()).user);
      setLoading(false);
    });
  }, [router, locale]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(locale === "en" ? "Confirm password does not match." : "Mật khẩu xác nhận không khớp.");
      return;
    }
    if (currentPassword === newPassword) {
      setError(locale === "en" ? "New password must be different from current password." : "Mật khẩu mới phải khác mật khẩu hiện tại.");
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
    setError(payload.message ?? (locale === "en" ? "Unable to change password." : "Không thể đổi mật khẩu."));
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
            <span className="eyebrow">{locale === "en" ? "Account" : "Tài khoản"}</span>
            <h1>{user?.username}</h1>
            <p>
              {roleLabel(user?.role, locale)} · {locale === "en" ? "Manage passwords and CLI access." : "Quản lý mật khẩu và quyền truy cập CLI."}
            </p>
          </div>
          <button className="secondary-button" onClick={logout}>
            <LogOut />
            {locale === "en" ? "Sign out" : "Đăng xuất"}
          </button>
        </div>
        {user?.mustChangePassword && (
          <div className="default-credential-warning">
            <ShieldCheck />
            <span>
              {locale === "en"
                ? "You are using a temporary password. Please change your password before performing administrative tasks or creating tokens."
                : "Bạn đang dùng mật khẩu tạm thời. Hãy đổi mật khẩu trước khi thực hiện thao tác quản trị hoặc tạo token."}
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
              <span className="eyebrow">{locale === "en" ? "Security" : "Bảo mật"}</span>
              <h2>{locale === "en" ? "Change password" : "Đổi mật khẩu"}</h2>
              <p>
                {locale === "en" ? "Your current session will end after successfully changing the password." : "Phiên đăng nhập hiện tại sẽ kết thúc sau khi đổi thành công."}
              </p>
            </div>
            <label>
              {locale === "en" ? "Current password" : "Mật khẩu hiện tại"}
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              {locale === "en" ? "New password (at least 10 characters)" : "Mật khẩu mới (tối thiểu 10 ký tự)"}
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
              {locale === "en" ? "Confirm new password" : "Xác nhận mật khẩu mới"}
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
              {loading ? (locale === "en" ? "Changing…" : "Đang đổi…") : (locale === "en" ? "Change password" : "Đổi mật khẩu")}
            </button>
          </form>
          <aside className="side-card account-access-card">
            <PackageOpen />
            <span className="eyebrow">{locale === "en" ? "Developer access" : "Truy cập nhà phát triển"}</span>
            <h2>{locale === "en" ? "Personal access token" : "Token truy cập cá nhân"}</h2>
            <p>
              {locale === "en"
                ? "Create and revoke tokens for use with dart pub, CI, or package publishing workflows."
                : "Tạo và thu hồi token dùng với dart pub, CI hoặc quy trình phát hành package."}
            </p>
            <Link className="primary-button" href="/tokens">
              {locale === "en" ? "Manage tokens" : "Quản lý token"}
            </Link>
          </aside>
        </div>
      </div>
    </main>
  );
}

function roleLabel(role?: string, locale?: "vi" | "en") {
  if (locale === "en") {
    if (role === "super_admin") return "Super Admin";
    if (role === "admin") return "Admin";
    return "User";
  }
  if (role === "super_admin") return "Quản trị viên cấp cao";
  if (role === "admin") return "Quản trị viên";
  return "Người dùng";
}
