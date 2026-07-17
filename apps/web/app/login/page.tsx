"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, LogIn, ShieldAlert } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/api/auth/me", { cache: "no-store" }).then((response) => { if (response.ok) router.replace("/tokens"); }); }, [router]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Đăng nhập không thành công.");
      router.replace("/tokens"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Đăng nhập không thành công."); }
    finally { setLoading(false); }
  }

  return <main className="auth-page"><form className="auth-card" onSubmit={login}>
    <div className="auth-icon"><KeyRound /></div><span className="eyebrow">Private registry account</span><h1>Đăng nhập</h1><p>Quản lý token theo tài khoản của bạn.</p>
    <div className="default-credential-warning"><ShieldAlert /><span>Lần chạy đầu tiên dùng <code>admin / admin</code>. Hệ thống sẽ yêu cầu đổi mật khẩu trước khi tạo token.</span></div>
    <label>Tên đăng nhập<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
    <label>Mật khẩu<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <LogIn />}{loading ? "Đang đăng nhập…" : "Đăng nhập"}</button>
  </form></main>;
}
