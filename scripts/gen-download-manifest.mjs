// Writes <dir>/manifest.json: the Home download list (version + one entry per
// file with its size and SHA-256), from the binaries and portable ZIPs in
// <dir>. Shared by scripts/dist-agent.sh and the release workflow so the local
// and CI builds produce the identical list the Home screen reads.
//   node scripts/gen-download-manifest.mjs <dir> <version>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const [dir, version] = process.argv.slice(2);
if (!dir || !version) {
  console.error("usage: gen-download-manifest.mjs <dir> <version>");
  process.exit(1);
}

const files = readdirSync(dir)
  .filter((f) => /^modfield-agent_|^ModField-Agent-/.test(f))
  .sort()
  .map((name) => {
    const m = name.match(/(linux|windows|darwin)[_-](amd64|arm64)/);
    const buf = readFileSync(join(dir, name));
    const kind = name.endsWith(".zip") ? "portable" : name.endsWith("-setup.exe") ? "installer" : "binary";
    return {
      name,
      os: m[1],
      arch: m[2],
      kind,
      bytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
    };
  });

writeFileSync(join(dir, "manifest.json"), `${JSON.stringify({ version, files }, null, 2)}\n`);
console.log(`wrote ${join(dir, "manifest.json")} (${files.length} files, v${version})`);
