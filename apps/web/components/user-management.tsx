"use client";

import type { AccountRole, AccountSummary } from "@private-pub/contracts";
import { Badge } from "@private-pub/ui";
import {
  CheckCircle2,
  LoaderCircle,
  Plus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";

export function UserManagement() {
  const { locale } = useLanguage();
  const [users, setUsers] = useState<AccountSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AccountRole>("user");
  const [currentRole, setCurrentRole] = useState<AccountRole>("user");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [response, meResponse] = await Promise.all([
      fetch("/api/admin/accounts", { cache: "no-store" }),
      fetch("/api/auth/me", { cache: "no-store" }),
    ]);
    if (meResponse.ok) setCurrentRole((await meResponse.json()).user.role);
    if (response.ok) setUsers((await response.json()).items);
    else
      setError(
        response.status === 401
          ? (locale === "en" ? "Please sign in to manage users." : "Hãy đăng nhập để quản lý người dùng.")
          : response.status === 403
            ? (locale === "en" ? "Current account does not have user administration privileges." : "Tài khoản hiện tại không có quyền quản trị người dùng.")
            : (locale === "en" ? "Unable to load users." : "Không thể tải danh sách người dùng."),
      );
    setLoading(false);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const response = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, role }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(
        payload.message ??
          (response.status === 409
            ? (locale === "en" ? "Username already exists." : "Tên đăng nhập đã tồn tại.")
            : (locale === "en" ? "Unable to create user." : "Không thể tạo người dùng.")),
      );
      setLoading(false);
      return;
    }
    setSuccess(
      locale === "en"
        ? `Account ${payload.user.username} created. The user will be required to change their password upon first sign-in.`
        : `Đã tạo tài khoản ${payload.user.username}. Người dùng sẽ phải đổi mật khẩu khi đăng nhập lần đầu.`,
    );
    setUsername("");
    setPassword("");
    setRole("user");
    setOpen(false);
    await load();
  }

  return (
    <section className="panel-card user-management">
      <div className="panel-title">
        <div>
          <span className="eyebrow">Access control</span>
          <strong>Người dùng</strong>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X /> : <Plus />}
          {open ? "Đóng" : "Tạo người dùng"}
        </button>
      </div>
      {open && (
        <form className="account-create-form" onSubmit={createUser}>
          <label>
            Tên đăng nhập
            <input
              value={username}
              onChange={(event) =>
                setUsername(event.target.value.toLowerCase())
              }
              minLength={3}
              maxLength={40}
              pattern="[a-z][a-z0-9._-]*"
              placeholder="nguyen.van.a"
              required
            />
          </label>
          <label>
            Mật khẩu tạm thời
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={10}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Vai trò
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as AccountRole)}
            >
              <option value="user">{locale === "en" ? "User" : "Người dùng"}</option>
              {currentRole === "super_admin" && (
                <option value="admin">{locale === "en" ? "Admin" : "Quản trị viên"}</option>
              )}
              {currentRole === "super_admin" && (
                <option value="super_admin">{locale === "en" ? "Super Admin" : "Quản trị viên cấp cao"}</option>
              )}
            </select>
          </label>
          <button className="primary-button" disabled={loading}>
            {loading ? <LoaderCircle className="spin" /> : <UserPlus />}
            {loading ? "Đang tạo…" : "Tạo tài khoản"}
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="form-success">
          <CheckCircle2 />
          {success}
        </p>
      )}
      {loading && users.length === 0 ? (
        <div className="center-loader">
          <LoaderCircle className="spin" />
        </div>
      ) : (
        <div className="account-list">
          {users.map((user) => (
            <div className="account-row" key={user.id}>
              <span className="account-avatar">
                <Users />
              </span>
              <div>
                <strong>{user.username}</strong>
                <small>{roleLabel(user.role, locale)}</small>
              </div>
              {user.mustChangePassword && (
                <Badge tone="amber">Chờ đổi mật khẩu</Badge>
              )}
              <Badge tone={user.isActive ? "green" : "neutral"}>
                {user.isActive ? "Đang hoạt động" : "Đã khóa"}
              </Badge>
            </div>
          ))}
          {!users.length && !error && (
            <p className="empty-note">Chưa có tài khoản nào.</p>
          )}
        </div>
      )}
    </section>
  );
}

function roleLabel(role: AccountRole, locale: "vi" | "en") {
  if (locale === "en") {
    if (role === "super_admin") return "Super Admin";
    if (role === "admin") return "Admin";
    return "User";
  }
  if (role === "super_admin") return "Quản trị viên cấp cao";
  if (role === "admin") return "Quản trị viên";
  return "Người dùng";
}
