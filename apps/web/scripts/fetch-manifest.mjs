// Bakes the published release's download manifest into the static output, so the
// Home can read /downloads/manifest.json same-origin. The GitHub release asset
// sends no CORS header, so a browser fetch of the redirected URL is blocked; the
// build runs server-side (no CORS) and follows the redirect fine. A missing or
// unpublished release just leaves the file out (the Home then shows "not
// published"). Refreshed on every site deploy.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = "https://github.com/fabandrade88/ModField/releases/latest/download/manifest.json";
const OUT = fileURLToPath(new URL("../out/downloads/", import.meta.url));

try {
  const res = await fetch(SRC, { redirect: "follow" });
  if (!res.ok) {
    console.log(`manifest: release not available (${res.status}); skipping`);
    process.exit(0);
  }
  const text = await res.text();
  JSON.parse(text); // fail loudly if it isn't the JSON we expect
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}manifest.json`, text);
  console.log("manifest: wrote out/downloads/manifest.json");
} catch (err) {
  // Never fail the build over this — the Home degrades to "not published".
  console.log(`manifest: skipped (${err.message})`);
}
