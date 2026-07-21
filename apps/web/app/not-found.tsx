import Link from "next/link";
import { PackageX } from "lucide-react";
export default function NotFound() {
  return (
    <main className="not-found">
      <PackageX />
      <h1>Package not found</h1>
      <p>The package may be private, renamed, or unavailable.</p>
      <Link href="/">Back to registry</Link>
    </main>
  );
}
