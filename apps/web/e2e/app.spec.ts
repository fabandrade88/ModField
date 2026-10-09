import { expect, test, type Page } from "@playwright/test";

/** Fails the test on any CSP violation or uncaught page error. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

async function startDemo(page: Page) {
  await page.goto("/pt/");
  await expect(page.getByRole("dialog", { name: "Como você vai conectar?" })).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("footer [data-state]")).toHaveText(/CONECTADO/);
}

test("demo mode: read, traffic and status bar", async ({ page }) => {
  const errors = watchErrors(page);
  await startDemo(page);

  // The demo opens Read in pane 1 and Monitor in pane 2.
  const read = page.getByRole("region", { name: "Painel 1" });
  await page.keyboard.press("r");
  const rows = read.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  // Input register 0 of unit 1 is the output frequency, a sine around 4500.
  const value = Number(await rows.first().locator("td").nth(2).innerText());
  expect(value).toBeGreaterThan(4400);
  expect(value).toBeLessThan(4600);

  const traffic = page.getByRole("region", { name: "Painel 2" });
  await expect(traffic.getByText("Read Input @0 ×4")).toBeVisible();
  await expect(traffic.getByText("01 04 00 00 00 04", { exact: false })).toBeVisible();

  await expect(page.locator("footer")).toContainText("Demonstração · 19200 8E1");
  expect(errors).toEqual([]);
});

test("a missing slave times out with a teaching message", async ({ page }) => {
  await startDemo(page);
  const read = page.getByRole("region", { name: "Painel 1" });
  await read.getByLabel("Unit ID").fill("9");
  await read.getByRole("button", { name: /Ler agora/ }).click();
  const alert = read.getByRole("alert");
  await expect(alert).toContainText("TIMEOUT");
  await expect(alert).toContainText("Escravo 9 não respondeu em 1000 ms");
  await expect(page.locator("footer")).toContainText("1 timeouts");
});

test("an unmapped address answers exception 02", async ({ page }) => {
  await startDemo(page);
  const read = page.getByRole("region", { name: "Painel 1" });
  await read.getByLabel("Endereço").fill("500");
  await page.keyboard.press("Escape");
  await read.getByRole("button", { name: /Ler agora/ }).click();
  await expect(read.getByRole("alert")).toContainText("MODBUS_EXCEPTION 02");
  await expect(read.getByRole("alert")).toContainText("Endereço não existe no escravo");
});

test("FLOAT32 in CDAB from the pressure transmitter", async ({ page }) => {
  await startDemo(page);
  const read = page.getByRole("region", { name: "Painel 1" });
  await read.getByLabel("Unit ID").fill("2");
  await read.getByLabel("Tabela").selectOption("holding");
  await read.getByLabel("Quantidade").fill("1");
  await read.getByLabel("Tipo").selectOption("FLOAT32");
  await read.getByLabel("Ordem").selectOption("CDAB");
  await read.getByRole("button", { name: /Ler agora/ }).click();
  const value = Number(await read.locator("tbody tr").first().locator("td").nth(2).innerText());
  expect(value).toBeGreaterThan(5.7);
  expect(value).toBeLessThan(6.7);
});

test("keyboard: modules, pane focus and help", async ({ page }) => {
  await startDemo(page);
  const pane1 = page.getByRole("region", { name: "Painel 1" });
  const pane2 = page.getByRole("region", { name: "Painel 2" });
  await pane1.locator("header span").first().click();
  await expect(pane1).toHaveAttribute("data-focused", "true");

  await page.keyboard.press("]");
  await expect(pane2).toHaveAttribute("data-focused", "true");
  await page.keyboard.press("1");
  await expect(pane2.getByRole("combobox", { name: "Módulo do painel" })).toHaveValue("connection");
  await page.keyboard.press("[");
  await expect(pane1).toHaveAttribute("data-focused", "true");

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Atalhos" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // One-letter shortcuts are ignored while typing in a field.
  await pane1.getByLabel("Unit ID").press("2");
  await expect(pane2.getByRole("combobox", { name: "Módulo do painel" })).toHaveValue("connection");
});

test("Ctrl+Enter disconnects and reconnects the demo", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("region", { name: "Painel 1" }).locator("header span").first().click();
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("footer [data-state]")).toHaveText(/DESCONECTADO/);
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("footer [data-state]")).toHaveText(/CONECTADO/);
});

test("theme and preferences persist across reloads", async ({ page }) => {
  await startDemo(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Configurações" }).click();
  const pane = page.getByRole("region", { name: "Painel 1" });
  await pane.getByLabel("Tema").selectOption("alto-contraste");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "alto-contraste");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "alto-contraste");
  // First use is not shown again.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("English and German routes", async ({ page }) => {
  await page.goto("/en/");
  await expect(page.getByRole("dialog", { name: "How will you connect?" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/de/");
  await expect(page.getByRole("dialog", { name: "Wie verbinden Sie sich?" })).toBeVisible();
});

test("root redirects by browser language", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "de-DE" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/de\/$/);
  await ctx.close();
});

test("the CSP blocks injected inline scripts", async ({ page }) => {
  await page.goto("/pt/");
  const ran = await page.evaluate(async () => {
    const w = window as unknown as { injected?: boolean };
    const s = document.createElement("script");
    s.textContent = "window.injected = true";
    document.body.append(s);
    await new Promise((r) => setTimeout(r, 50));
    return Boolean(w.injected);
  });
  expect(ran).toBe(false);
});

test("the saved theme is applied before the app's JavaScript loads (no flash)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("modfield.ui", JSON.stringify({ state: { theme: "gruvbox", firstUseDone: true }, version: 0 }));
  });
  // Block the app bundles: only the inline theme script can set the attribute.
  await page.route("**/_next/static/**/*.js", (r) => r.abort());
  await page.goto("/pt/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "gruvbox");
});
