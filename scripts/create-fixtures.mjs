import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "fixtures/sample_package");
const targetDir = resolve(root, "fixtures/archives");
mkdirSync(targetDir, { recursive: true });
execFileSync(
  "tar",
  [
    "-czf",
    resolve(targetDir, "sample_package-1.0.0.tar.gz"),
    "-C",
    source,
    ".",
  ],
  { stdio: "inherit" },
);
console.info("Created fixtures/archives/sample_package-1.0.0.tar.gz");
