import type { Metadata } from "next";
import { headers } from "next/headers";
import { Nav } from "@/components/nav";
import { LanguageProvider } from "@/components/language-provider";
import { Footer } from "@/components/footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Constellation Registry",
    template: "%s · Constellation",
  },
  description: "Private Dart and Flutter package registry",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Nonce-based CSP requires per-request rendering so Next can attach the
  // middleware nonce to its framework and hydration scripts.
  await headers();
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>
        <LanguageProvider>
          <Nav />
          {children}
          <Footer />
        </LanguageProvider>
      </body>
    </html>
  );
}
