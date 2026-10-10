import { expect, test } from "@playwright/test";
import { pane, startDemo, watchErrors } from "./helpers";

test("documentation in three languages, with navigation", async ({ page }) => {
  const errors = watchErrors(page);
  for (const [lang, title, guide] of [
    ["pt", "Documentação do ModField", "Encontrar um escravo desconhecido"],
    ["en", "ModField documentation", "Find an unknown slave"],
    ["de", "ModField-Dokumentation", "Einen unbekannten Slave finden"],
  ] as const) {
    await page.goto(`/${lang}/docs/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await page.getByRole("navigation").getByRole("link", { name: guide }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(guide);
    await expect(page.locator("ol.docs-steps > li").first()).toBeVisible();
    await expect(page.getByRole("img").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("local search finds a page", async ({ page }) => {
  await page.goto("/pt/docs/");
  await page.getByRole("searchbox", { name: "Buscar na documentação" }).fill("terminação");
  await page.getByRole("option").first().getByRole("link").click();
  await expect(page).toHaveURL(/\/pt\/docs\/hardware/);
});

test("an error links to its exact troubleshooting entry", async ({ page, context }) => {
  await startDemo(page);
  const read = pane(page, 1);
  await read.getByRole("tab", { name: "Bloco" }).click();
  await read.getByLabel("Unit ID").fill("9");
  await read.getByRole("button", { name: /Ler agora/ }).click();
  const link = read.getByRole("alert").getByRole("link", { name: /Como resolver/ });
  await expect(link).toHaveAttribute("href", "/pt/docs/troubleshooting/#timeout");
  const [docs] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await expect(docs.locator("#timeout")).toBeVisible();
  await expect(docs.locator("#timeout")).toContainText("TIMEOUT");
});

test("the ? next to a technical field explains it", async ({ page }) => {
  await startDemo(page);
  await pane(page, 2).getByRole("combobox", { name: "Módulo do painel" }).selectOption("connection");
  await pane(page, 2).getByRole("tab", { name: "RTU (serial)" }).click();
  await pane(page, 2).getByRole("button", { name: "Saiba mais" }).first().click();
  const tip = page.locator("[popover]:popover-open");
  await expect(tip).toContainText("Paridade");
  await expect(tip.getByRole("link")).toHaveAttribute("href", "/pt/docs/guides/baud-rate");
});

test("works offline after the first visit (tool and docs)", async ({ page, context, browserName }) => {
  test.skip(browserName === "firefox", "Playwright's offline mode does not route Firefox service workers reliably");
  await page.goto("/pt/");
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    // Wait for the precache to finish (install done, worker active).
    while (!reg.active) await new Promise((r) => setTimeout(r, 100));
  });
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Como você vai conectar?" })).toBeVisible();
  await page.goto("/pt/docs/hardware/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hardware RS-485");
  await context.setOffline(false);
});

test("the demo bench speaks the UI language", async ({ page }) => {
  await page.goto("/de/");
  await page.getByRole("dialog", { name: "Wie verbinden Sie sich?" }).waitFor();
  await page.keyboard.press("3");
  await expect(pane(page, 1).getByRole("row").filter({ hasText: "Ausgangsfrequenz" })).toBeVisible();
  await expect(page.locator("footer")).toContainText("Demo · 19200 8E1");
});
