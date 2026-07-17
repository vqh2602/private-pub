"use client";

import Link from "next/link";
import {
  Box,
  KeyRound,
  Menu,
  Moon,
  Search,
  ShieldCheck,
  Smartphone,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";

type SessionUser = { username: string; role: string };

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const { locale, setLocale, t } = useLanguage();
  useEffect(() => {
    const enabled = localStorage.getItem("theme") === "dark";
    setDark(enabled);
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as { user?: SessionUser };
        return payload.user ?? null;
      })
      .then((sessionUser) => setUser(sessionUser))
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError"))
          setUser(null);
      });
    return () => controller.abort();
  }, [pathname]);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
  }
  return (
    <header className="topbar">
      <div className="nav-shell">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Box size={19} />
          </span>
          <span>Constellation</span>
          <i>Registry</i>
        </Link>
        <nav className={open ? "nav-links open" : "nav-links"}>
          <Link href="/">
            <Search size={16} />
            {t.packages}
          </Link>
          <Link href="/flutter">
            <Smartphone size={16} />
            {t.flutter}
          </Link>
          <Link href="/publishers/platform.internal">
            <ShieldCheck size={16} />
            {t.publishers}
          </Link>
          <Link href="/admin">{t.admin}</Link>
          <Link href="/imports">{t.imports}</Link>
        </nav>
        <div className="nav-actions">
          <button
            className="icon-button"
            aria-label={t.toggleTheme}
            onClick={toggleTheme}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <label className="language-select">
            <span className="sr-only">{t.language}</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value as "vi" | "en")} aria-label={t.language}>
              <option value="vi">{t.vietnamese}</option><option value="en">{t.english}</option>
            </select>
          </label>
          <Link href={user ? "/account" : "/login"} className="profile">
            <span>
              {user ? <UserRound size={15} /> : <KeyRound size={15} />}
            </span>
            <div>
              <strong>{user?.username ?? t.account}</strong>
              <small>{user ? roleLabel(user.role, locale) : t.signIn}</small>
            </div>
          </Link>
          <button
            className="menu-button"
            onClick={() => setOpen(!open)}
            aria-label={t.toggleMenu}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
    </header>
  );
}

function roleLabel(role: string, locale: "vi" | "en") {
  if (locale === "en") {
    if (role === "super_admin") return "Super administrator";
    if (role === "admin") return "Administrator";
    return "Signed-in account";
  }
  if (role === "super_admin") return "Quản trị viên cấp cao";
  if (role === "admin") return "Quản trị viên";
  return "Tài khoản đã đăng nhập";
}
