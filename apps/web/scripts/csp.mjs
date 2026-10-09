// Adds a strict Content-Security-Policy <meta> to every exported HTML page.
// Next's static export emits inline bootstrap scripts; instead of allowing
// 'unsafe-inline', each one is allowed by its SHA-256 hash.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../out/", import.meta.url).pathname;
const AGENT_PORTS = [47807, 47808, 47809];

const agent = AGENT_PORTS.flatMap((p) => [`ws://127.0.0.1:${p}`, `http://127.0.0.1:${p}`]).join(" ");

export function policy(scriptHashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.map((h) => `'sha256-${h}'`).join(" ")}`.trim(),
    // Style attributes (style={{...}}) are allowed; style elements and sheets must come from us.
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${agent}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html")) yield p;
  }
}

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

let pages = 0;
for (const file of htmlFiles(OUT)) {
  let html = readFileSync(file, "utf8");
  if (html.includes('http-equiv="Content-Security-Policy"')) continue;
  const hashes = new Set();
  for (const m of html.matchAll(INLINE_SCRIPT)) {
    if (m[1].length) hashes.add(createHash("sha256").update(m[1], "utf8").digest("base64"));
  }
  if (/<style[\s>]/.test(html)) {
    throw new Error(`${file}: inline <style> found; it would be blocked by style-src 'self'`);
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy([...hashes])}">`;
  // The policy must come before any script, so it goes right after <head>.
  html = html.replace(/<head([^>]*)>/, `<head$1>${meta}`);
  writeFileSync(file, html);
  pages++;
}
console.log(`csp: policy added to ${pages} pages`);
