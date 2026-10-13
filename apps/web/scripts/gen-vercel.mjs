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
// (curl -fsSL) and the agent updater follow redirects, and binary downloads are
// plain navigations — none of them need CORS.
const RELEASE = "https://github.com/fabandrade88/ModField/releases/latest/download";
const redirects = [
  // Send the raw Vercel deployment URL to the real domain. The agent only trusts
  // https://modfield.app as an origin, so pairing has to happen there — anyone
  // landing on modfield.vercel.app would otherwise get an origin/CORS rejection.
  { source: "/:path*", has: [{ type: "host", value: "modfield.vercel.app" }], destination: "https://modfield.app/:path*", permanent: true },
  // 307 (temporary), not 308: "latest" moves with every release, so the redirect
  // is genuinely temporary — and Windows PowerShell 5.1's Invoke-WebRequest (the
  // default powershell.exe) refuses to follow a 308, breaking the install.ps1
  // one-liner. It follows 307, curl -L and browsers follow both.
  { source: "/downloads/latest/:file", destination: `${RELEASE}/:file`, permanent: false },
  // Everything except manifest.json, which the build bakes into the static
  // output as a same-origin file (scripts/fetch-manifest.mjs) so the Home's
  // fetch() isn't blocked by the GitHub asset's missing CORS header. Keeping it
  // out of the redirect lets Vercel serve that static file.
  { source: "/downloads/:file((?!manifest\\.json).+)", destination: `${RELEASE}/:file`, permanent: false },
];

// Static export: serve the post-processed out/ (csp.mjs adds the CSP <meta>,
// sw.mjs writes the service worker) as plain files, not through a framework
// adapter that would ignore that post-processing. framework:null = "Other".
// Root Directory is apps/web, so the build runs there and output is out/.
export const webConfig = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
  buildCommand: "pnpm run build",
  outputDirectory: "out",
  redirects,
  headers,
};

// Deployed from the repo root (default Root Directory): same, but build the
// monorepo and point at the static export under apps/web.
export const rootConfig = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
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
  // The drift guard runs locally and in CI. Skip it on Vercel: it reads and
  // normalises vercel.json during the deploy, so the file on disk no longer
  // matches what we generate, and the deployed redirects/headers come from
  // that file directly — the check would only (falsely) fail the build.
  if (check && process.env.VERCEL) {
    console.log("on Vercel: skipping the vercel.json drift check");
    process.exit(0);
  }
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
