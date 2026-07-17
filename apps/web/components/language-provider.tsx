"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { PageTranslator } from "@/components/page-translator";

export type Locale = "vi" | "en";
type Translation = Record<"packages" | "flutter" | "publishers" | "admin" | "imports" | "account" | "signIn" | "signedIn" | "toggleTheme" | "toggleMenu" | "loginEyebrow" | "loginTitle" | "loginDescription" | "initialCredentials" | "initialCredentialsSuffix" | "username" | "password" | "signingIn" | "login" | "loginFailed" | "language" | "vietnamese" | "english" | "footerDescription" | "apiDocs" | "systemStatus" | "cliSetup", string>;

const messages = {
  vi: {
    packages: "Gói", flutter: "Flutter SDK", publishers: "Nhà phát hành", admin: "Quản trị", imports: "Nhập gói",
    account: "Tài khoản", signIn: "Đăng nhập", signedIn: "Đã đăng nhập", toggleTheme: "Đổi giao diện sáng/tối", toggleMenu: "Mở/đóng menu",
    loginEyebrow: "Tài khoản private registry", loginTitle: "Đăng nhập", loginDescription: "Quản lý token theo tài khoản của bạn.",
    initialCredentials: "Lần chạy đầu tiên dùng", initialCredentialsSuffix: ". Hệ thống sẽ yêu cầu đổi mật khẩu trước khi tạo token.",
    username: "Tên đăng nhập", password: "Mật khẩu", signingIn: "Đang đăng nhập…", login: "Đăng nhập", loginFailed: "Đăng nhập không thành công.",
    language: "Ngôn ngữ", vietnamese: "Tiếng Việt", english: "English",
    footerDescription: "Kho package riêng, phát hành an tâm.", apiDocs: "Tài liệu API", systemStatus: "Trạng thái hệ thống", cliSetup: "Thiết lập CLI",
  },
  en: {
    packages: "Packages", flutter: "Flutter SDK", publishers: "Publishers", admin: "Admin", imports: "Imports",
    account: "Account", signIn: "Sign in", signedIn: "Signed in", toggleTheme: "Toggle color scheme", toggleMenu: "Toggle menu",
    loginEyebrow: "Private registry account", loginTitle: "Sign in", loginDescription: "Manage tokens for your account.",
    initialCredentials: "For the first run, use", initialCredentialsSuffix: ". You will be asked to change the password before creating a token.",
    username: "Username", password: "Password", signingIn: "Signing in…", login: "Sign in", loginFailed: "Sign-in failed.",
    language: "Language", vietnamese: "Tiếng Việt", english: "English",
    footerDescription: "Private packages, confidently shipped.", apiDocs: "API docs", systemStatus: "System status", cliSetup: "CLI setup",
  },
} satisfies Record<Locale, Translation>;
const LanguageContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void; t: Translation }>({ locale: "vi", setLocale: () => undefined, t: messages.vi });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("vi");
  useEffect(() => {
    const saved = localStorage.getItem("locale");
    if (saved === "en" || saved === "vi") setLocaleState(saved);
  }, []);
  const setLocale = (next: Locale) => {
    setLocaleState(next);
    localStorage.setItem("locale", next);
    document.documentElement.lang = next;
  };
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, t: messages[locale] }), [locale]);
  return <LanguageContext.Provider value={value}><PageTranslator locale={locale} />{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
