import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Constellation Registry", template: "%s · Constellation" }, description: "Private Dart and Flutter package registry" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><Nav />{children}<footer><div><strong>Constellation Registry</strong><span>Private packages, confidently shipped.</span></div><nav><a href="http://localhost:4000/docs">API docs</a><a href="/admin">System status</a><a href="/tokens">CLI setup</a></nav></footer></body></html>;
}
