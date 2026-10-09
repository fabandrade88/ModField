import { defineConfig, devices } from "@playwright/test";

// Locally, any Chromium-based browser works (e.g. PLAYWRIGHT_CHROMIUM=/usr/bin/brave);
// CI uses Playwright's own Chromium.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...devices["Desktop Chrome"],
    viewport: { width: 1366, height: 768 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    // Tests run against the static export, CSP included: `pnpm build` first.
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:3100/pt/",
    reuseExistingServer: !process.env.CI,
  },
});
