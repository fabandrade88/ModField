// Real screenshots for the docs, taken from the static build with the demo
// bench (MockTransport): public/docs/<lang>/{read,scan,logger}.png.
// Run: pnpm build && node scripts/serve.mjs & node scripts/docs-screenshots.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const UI = {
  pt: { demo: "Abrir a demonstração", logger: "Iniciar registro", interval: "Intervalo (ms)", duration: "Duração (min)", event: "Evento", marker: "válvula aberta 50%", start: "Iniciar varredura", go: "Varrer", to: "Até" },
  en: { demo: "Open the demo", logger: "Start logging", interval: "Interval (ms)", duration: "Duration (min)", event: "Event", marker: "valve 50% open", start: "Start scan", go: "Scan", to: "To" },
  de: { demo: "Demo öffnen", logger: "Aufzeichnung starten", interval: "Intervall (ms)", duration: "Dauer (min)", event: "Ereignis", marker: "Ventil 50 % offen", start: "Scan starten", go: "Scannen", to: "Bis" },
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
for (const [lang, ui] of Object.entries(UI)) {
  const dir = new URL(`../public/docs/${lang}/`, import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/${lang}/`);
  await page.locator("[data-path=demo]").getByRole("button", { name: ui.demo }).click();
  await page.locator("tbody tr").first().waitFor();
  await page.locator("main section header span").first().click();
  await page.keyboard.press("p");
  await page.waitForTimeout(2500);
  await page.locator("main section").first().locator("tbody tr").nth(1).click();
  await page.screenshot({ path: dir + "read.png" });
  await page.keyboard.press("Escape");

  // Scanner in pane 2.
  await page.locator("main section header span").nth(1).click();
  await page.keyboard.press("4");
  const pane2 = page.locator("main section").nth(1);
  await pane2.getByLabel(ui.to).fill("12");
  await pane2.getByRole("button", { name: ui.start }).click();
  await page.getByRole("dialog").getByRole("button", { name: ui.go }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: dir + "scan.png" });

  // Logger in pane 1, single pane.
  await page.locator("main section header span").first().click();
  await page.keyboard.press("p");
  await page.keyboard.press("7");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByLabel(ui.interval).fill("200");
  await page.getByLabel(ui.duration).fill("5");
  await page.getByRole("button", { name: new RegExp(ui.logger) }).click();
  await page.waitForTimeout(3000);
  await page.keyboard.press("m");
  await page.getByRole("textbox", { name: ui.event }).fill(ui.marker);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3500);
  await page.locator(".trend").scrollIntoViewIfNeeded();
  await page.screenshot({ path: dir + "logger.png" });
  await page.close();
  console.log(`docs screenshots: ${lang}`);
}
await browser.close();
