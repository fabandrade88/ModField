// Writes the Vercel config from the shared security-headers list, so the
// deployed headers stay in sync with the preview. Two files, one per deploy
// layout; run after editing security-headers.mjs:
//   node scripts/gen-vercel.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { SECURITY_HEADERS } from "../lib/security-headers.mjs";

const headers = [{ source: "/(.*)", headers: SECURITY_HEADERS }];

// The agent binaries, checksums, install.sh and the signed update.json are too
// big and too frequently updated to live in the site deploy, so /downloads/*
// redirects to the latest GitHub Release (its CDN serves the bytes). install.sh
// (curl -fsSL) and the agent updater both follow redirects.
const RELEASE = "https://github.com/fabandrade88/ModField/releases/latest/download";
const redirects = [
  { source: "/downloads/latest/:file", destination: `${RELEASE}/:file` },
  { source: "/downloads/:file", destination: `${RELEASE}/:file` },
];

// Deployed with the Vercel "Root Directory" set to apps/web: build and output
// are the defaults, so this file only carries the headers.
export const webConfig = { $schema: "https://openapi.vercel.sh/vercel.json", redirects, headers };

// Deployed from the repo root (default Root Directory): also tell Vercel how to
// build the monorepo and where the static export lands.
export const rootConfig = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  buildCommand: "pnpm build",
  outputDirectory: "apps/web/out",
  redirects,
  headers,
};

const str = (o) => `${JSON.stringify(o, null, 2)}\n`;

// path relative to this script -> [object, label]
const targets = [
  [fileURLToPath(new URL("../vercel.json", import.meta.url)), str(webConfig), "apps/web/vercel.json"],
  [fileURLToPath(new URL("../../../vercel.json", import.meta.url)), str(rootConfig), "vercel.json (repo root)"],
];

// Kept for the e2e header assertion.
export const vercelJson = str(webConfig);

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const check = argv.includes("--check");
  // Compare EOL-insensitively: on Windows git may check these out with CRLF.
  const norm = (s) => s.replace(/\r\n/g, "\n");
  for (const [path, want, label] of targets) {
    if (check) {
      if (norm(readFileSync(path, "utf8")) !== norm(want)) {
        console.error(`${label} is out of date; run: node scripts/gen-vercel.mjs`);
        process.exit(1);
      }
    } else {
      writeFileSync(path, want);
      console.log(`wrote ${label}`);
    }
  }
  if (check) console.log("vercel configs are in sync");
}
