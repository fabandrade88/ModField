// Serves out/ like a static host, for e2e tests and local checks: no server code.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { SECURITY_HEADERS } from "../lib/security-headers.mjs";

// Mirror the production (Vercel) response headers so the preview and e2e see the same policy.
const SECURITY = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));

const ROOT = fileURLToPath(new URL("../out/", import.meta.url));
const PORT = Number(process.env.PORT ?? 3100);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".zip": "application/zip",
  ".exe": "application/octet-stream",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".ico": "image/x-icon",
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) return res.writeHead(403).end();
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path)) {
    res.writeHead(404, { "content-type": TYPES[".html"], ...SECURITY });
    return createReadStream(join(ROOT, "404.html")).pipe(res);
  }
  // The search index is a route handler exported as a file without extension.
  const type = url.pathname === "/api/search" ? "application/json" : (TYPES[extname(path)] ?? "application/octet-stream");
  res.writeHead(200, { "content-type": type, ...SECURITY });
  createReadStream(path).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`serving out/ on http://127.0.0.1:${PORT}`));
