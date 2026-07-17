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

type SessionUser = { username: string; role: string };

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
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
            Packages
          </Link>
          <Link href="/flutter">
            <Smartphone size={16} />
            Flutter SDK
          </Link>
          <Link href="/publishers/platform.internal">
            <ShieldCheck size={16} />
            Publishers
          </Link>
          <Link href="/admin">Admin</Link>
          <Link href="/imports">Imports</Link>
        </nav>
        <div className="nav-actions">
          <button
            className="icon-button"
            aria-label="Toggle color scheme"
            onClick={toggleTheme}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <Link href={user ? "/account" : "/login"} className="profile">
            <span>
              {user ? <UserRound size={15} /> : <KeyRound size={15} />}
            </span>
            <div>
              <strong>{user?.username ?? "Tài khoản"}</strong>
              <small>{user ? roleLabel(user.role) : "Đăng nhập"}</small>
            </div>
          </Link>
          <button
            className="menu-button"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
    </header>
  );
}

function roleLabel(role: string) {
  if (role === "super_admin") return "Quản trị viên cấp cao";
  if (role === "admin") return "Quản trị viên";
  return "Tài khoản đã đăng nhập";
}
