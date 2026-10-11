// Writes the Vercel config from the shared security-headers list, so the
// deployed headers stay in sync with the preview. Two files, one per deploy
// layout; run after editing security-headers.mjs:
//   node scripts/gen-vercel.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { SECURITY_HEADERS } from "../lib/security-headers.mjs";

const headers = [{ source: "/(.*)", headers: SECURITY_HEADERS }];

// Deployed with the Vercel "Root Directory" set to apps/web: build and output
// are the defaults, so this file only carries the headers.
export const webConfig = { $schema: "https://openapi.vercel.sh/vercel.json", headers };

// Deployed from the repo root (default Root Directory): also tell Vercel how to
// build the monorepo and where the static export lands.
export const rootConfig = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  buildCommand: "pnpm build",
  outputDirectory: "apps/web/out",
  headers,
};

const str = (o) => `${JSON.stringify(o, null, 2)}\n`;

// path relative to this script -> [object, label]
const targets = [
  [new URL("../vercel.json", import.meta.url).pathname, str(webConfig), "apps/web/vercel.json"],
  [new URL("../../../vercel.json", import.meta.url).pathname, str(rootConfig), "vercel.json (repo root)"],
];

// Kept for the e2e header assertion.
export const vercelJson = str(webConfig);

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const check = argv.includes("--check");
  for (const [path, want, label] of targets) {
    if (check) {
      if (readFileSync(path, "utf8") !== want) {
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
