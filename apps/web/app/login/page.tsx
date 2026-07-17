"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, LogIn, ShieldAlert } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

const LAST_USERNAME_KEY = "private-pub:last-username";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLanguage();
  useEffect(() => {
    setUsername(localStorage.getItem(LAST_USERNAME_KEY) ?? "");
    fetch("/api/auth/me", { cache: "no-store" }).then((response) => { if (response.ok) router.replace("/tokens"); });
  }, [router]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? t.loginFailed);
      localStorage.setItem(LAST_USERNAME_KEY, username.trim());
      router.replace("/tokens"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.loginFailed); }
    finally { setLoading(false); }
  }

  return <main className="auth-page"><form className="auth-card" onSubmit={login}>
    <div className="auth-icon"><KeyRound /></div><span className="eyebrow">{t.loginEyebrow}</span><h1>{t.loginTitle}</h1><p>{t.loginDescription}</p>
    <div className="default-credential-warning"><ShieldAlert /><span>{t.initialCredentials} <code>admin / admin</code>{t.initialCredentialsSuffix}</span></div>
    <label>{t.username}<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
    <label>{t.password}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <LogIn />}{loading ? t.signingIn : t.login}</button>
  </form></main>;
}
