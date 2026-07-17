import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { LanguageProvider } from "@/components/language-provider";
import { Footer } from "@/components/footer";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Constellation Registry", template: "%s · Constellation" }, description: "Private Dart and Flutter package registry" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi" suppressHydrationWarning><body><LanguageProvider><Nav />{children}<Footer /></LanguageProvider></body></html>;
}
