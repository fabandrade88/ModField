// Writes vercel.json from the shared security-headers list, so the deployed
// headers stay in sync with the preview. Run after editing security-headers.mjs:
//   node scripts/gen-vercel.mjs
import { writeFileSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { SECURITY_HEADERS } from "../lib/security-headers.mjs";

export const vercelConfig = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  headers: [{ source: "/(.*)", headers: SECURITY_HEADERS }],
};

export const vercelJson = `${JSON.stringify(vercelConfig, null, 2)}\n`;

// Run directly: write vercel.json, or `--check` to fail if it has drifted.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const path = new URL("../vercel.json", import.meta.url).pathname;
  if (argv.includes("--check")) {
    const { readFileSync } = await import("node:fs");
    const onDisk = readFileSync(path, "utf8");
    if (onDisk !== vercelJson) {
      console.error("vercel.json is out of date; run: node scripts/gen-vercel.mjs");
      process.exit(1);
    }
    console.log("vercel.json is in sync");
  } else {
    writeFileSync(path, vercelJson);
    console.log(`wrote ${path}`);
  }
}
