"use client";

import Link from "next/link";
import { Box, KeyRound, Menu, Moon, Search, ShieldCheck, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";

export function Nav() {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => { const enabled = localStorage.getItem("theme") === "dark"; setDark(enabled); document.documentElement.dataset.theme = enabled ? "dark" : "light"; }, []);
  function toggleTheme() { const next = !dark; setDark(next); localStorage.setItem("theme", next ? "dark" : "light"); document.documentElement.dataset.theme = next ? "dark" : "light"; }
  return <header className="topbar">
    <div className="nav-shell">
      <Link href="/" className="brand"><span className="brand-mark"><Box size={19} /></span><span>Constellation</span><i>Registry</i></Link>
      <nav className={open ? "nav-links open" : "nav-links"}>
        <Link href="/"><Search size={16} />Packages</Link>
        <Link href="/publishers/platform.internal"><ShieldCheck size={16} />Publishers</Link>
        <Link href="/admin">Admin</Link>
        <Link href="/imports">Imports</Link>
      </nav>
      <div className="nav-actions">
        <button className="icon-button" aria-label="Toggle color scheme" onClick={toggleTheme}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        <Link href="/tokens" className="profile"><span><KeyRound size={15} /></span><div><strong>Tài khoản</strong><small>Đăng nhập &amp; token</small></div></Link>
        <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Toggle menu">{open ? <X /> : <Menu />}</button>
      </div>
    </div>
  </header>;
}
