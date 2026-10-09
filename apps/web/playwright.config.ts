import { defineConfig, devices } from "@playwright/test";

// Locally, any Chromium-based browser works (e.g. PLAYWRIGHT_CHROMIUM=/usr/bin/brave);
// CI uses Playwright's own Chromium. Firefox always uses Playwright's build.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const viewport = { width: 1366, height: 768 };

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:3100" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport, launchOptions: executablePath ? { executablePath } : {} },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport } },
  ],
  webServer: [
    {
      // Tests run against the static export, CSP included: `pnpm build` first.
      command: "node scripts/serve.mjs",
      url: "http://127.0.0.1:3100/pt/",
      reuseExistingServer: !process.env.CI,
    },
    {
      // The real Go agent (needs Go, pinned in mise.toml).
      command: "node scripts/e2e-agent.mjs",
      url: "http://127.0.0.1:47807/pair",
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
