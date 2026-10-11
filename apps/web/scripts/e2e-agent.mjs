// Builds and runs the real agent for the end-to-end tests: demo simulator on
// 127.0.0.1:5020, fixed pairing code, the test site's origin allowed.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(tmpdir(), "modfield-e2e-agent");
const bin = join(dir, process.platform === "win32" ? "modfield-agent.exe" : "modfield-agent");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
execFileSync("go", ["build", "-tags", "notray", "-o", bin, "./cmd/modfield-agent"], {
  cwd: fileURLToPath(new URL("../../../agent", import.meta.url)),
  stdio: "inherit",
});
const agent = spawn(
  bin,
  [
    "--headless", "--dev", "--no-browser", "--no-update",
    "--port", "47807",
    "--data-dir", join(dir, "data"),
    "--allow-origin", "http://127.0.0.1:3100",
    "--test-pairing-code", "246810",
    "--sim", "127.0.0.1:5020",
  ],
  { stdio: "inherit" },
);
const stop = () => agent.kill();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
agent.on("exit", (code) => process.exit(code ?? 0));
