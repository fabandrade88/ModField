import { expect, test } from "@playwright/test";
import { focusPane, pane, startDemo, watchErrors } from "./helpers";

test("demo mode: tags, traffic and status bar", async ({ page }) => {
  const errors = watchErrors(page);
  await startDemo(page);

  const read = pane(page, 1);
  await expect(read.getByRole("tab", { name: "Tags", selected: true })).toBeVisible();
  // Tags load from IndexedDB; R reads whatever is listed.
  await expect(read.getByRole("row").filter({ hasText: "Frequência de saída" })).toBeVisible();
  await page.keyboard.press("r");
  const freq = read.getByRole("row").filter({ hasText: "Frequência de saída" });
  await expect(freq).toContainText(/4[45]\.\d\d Hz/);
  const pressure = read.getByRole("row").filter({ hasText: "Pressão" });
  await expect(pressure).toContainText(/\d\.\d+ bar/);
  await expect(read.getByRole("row").filter({ hasText: "Tag do instrumento" })).toContainText("PT-101 RECALQUE");
  // 13 tags in 3 slaves, grouped by slave and table.
  await expect(read).toContainText(/requisições por ciclo/);

  const traffic = pane(page, 2);
  await expect(traffic.getByText("Read Input @0 ×5")).toBeVisible();
  await expect(page.locator("footer")).toContainText("Demonstração · 19200 8E1");
  expect(errors).toEqual([]);
});

test("block read: a missing slave times out with a teaching message", async ({ page }) => {
  await startDemo(page);
  const read = pane(page, 1);
  await read.getByRole("tab", { name: "Bloco" }).click();
  await read.getByLabel("Unit ID").fill("9");
  await read.getByRole("button", { name: /Ler agora/ }).click();
  const alert = read.getByRole("alert");
  await expect(alert).toContainText("TIMEOUT");
  await expect(alert).toContainText("Escravo 9 não respondeu em 1000 ms");
  await expect(page.locator("footer")).toContainText("1 timeouts");
});

test("block read: an unmapped address answers exception 02", async ({ page }) => {
  await startDemo(page);
  const read = pane(page, 1);
  await read.getByRole("tab", { name: "Bloco" }).click();
  await read.getByLabel("Endereço").fill("500");
  await read.getByRole("button", { name: /Ler agora/ }).click();
  await expect(read.getByRole("alert")).toContainText("MODBUS_EXCEPTION 02");
  await expect(read.getByRole("alert")).toContainText("Endereço não existe no escravo");
});

test("block read: FLOAT32 in CDAB from the pressure transmitter", async ({ page }) => {
  await startDemo(page);
  const read = pane(page, 1);
  await read.getByRole("tab", { name: "Bloco" }).click();
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
  const pane1 = pane(page, 1);
  const pane2 = pane(page, 2);
  await focusPane(page, 1);
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
  await expect(page.getByRole("dialog", { name: "Atalhos" })).toBeHidden();

  // One-letter shortcuts are ignored while typing in a field.
  await pane2.getByLabel("Nome do perfil").or(pane2.getByLabel("Timeout (ms)")).first().press("2");
  await expect(pane2.getByRole("combobox", { name: "Módulo do painel" })).toHaveValue("connection");
});

test("Ctrl+Enter disconnects and reconnects the demo", async ({ page }) => {
  await startDemo(page);
  await focusPane(page, 1);
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("footer [data-state]")).toHaveText(/DESCONECTADO/);
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("footer [data-state]")).toHaveText(/CONECTADO/);
});

test("theme and preferences persist across reloads", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: "Configurações" }).click();
  await pane(page, 1).getByLabel("Tema").selectOption("alto-contraste");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "alto-contraste");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "alto-contraste");
  // The first visit put Home in pane 1; later visits keep the layout the user chose.
  await expect(pane(page, 1).getByLabel("Tema")).toBeVisible();
});

test("English and German routes", async ({ page }) => {
  await page.goto("/en/");
  await expect(page.getByRole("heading", { name: "How will you connect?" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/de/");
  await expect(page.getByRole("heading", { name: "Wie verbinden Sie sich?" })).toBeVisible();
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
  await page.route("**/_next/static/**/*.js", (r) => r.abort());
  await page.goto("/pt/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "gruvbox");
});

test("Home explains how to start and is reachable from anywhere", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/pt/");
  const home = pane(page, 1);
  await expect(home.getByRole("heading", { name: "ModField: diagnóstico Modbus no navegador" })).toBeVisible();
  for (const path of ["usb", "tcp", "demo"]) await expect(home.locator(`[data-path=${path}]`)).toBeVisible();
  await expect(home.getByRole("img", { name: /Sem agente/ })).toBeVisible();
  await expect(home.getByRole("heading", { name: "Agente local" })).toBeVisible();
  await expect(home.getByRole("link", { name: /Guia de instalação/ })).toHaveAttribute("href", /\/pt\/docs\/.*install-agent/);
  await expect(home.getByRole("heading", { name: "Em 4 passos" })).toBeVisible();
  // USB opens Connection beside the traffic monitor.
  await home.locator("[data-path=usb]").getByRole("button", { name: "Conectar por USB" }).click();
  await expect(home.getByRole("combobox", { name: "Módulo do painel" })).toHaveValue("connection");
  await expect(pane(page, 2).getByRole("combobox", { name: "Módulo do painel" })).toHaveValue("traffic");
  // H brings it back; the docs link is always in the sidebar.
  await page.keyboard.press("h");
  await expect(home.getByRole("heading", { name: "Como você vai conectar?" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: /Documentação/ })).toHaveAttribute("href", "/pt/docs/");
  expect(errors).toEqual([]);
});

test("the language switch is always visible and keeps the connection", async ({ page }) => {
  const errors = watchErrors(page);
  await startDemo(page);
  const langs = page.getByRole("navigation").getByRole("combobox", { name: "Idioma" });
  await expect(langs).toHaveValue("pt");
  await langs.selectOption("en");
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("navigation").getByRole("button", { name: "Home" })).toBeVisible();
  // No reload: the session is still connected.
  await expect(page.locator("footer [data-state]")).toHaveText(/CONNECTED/);
  await page.getByRole("navigation").getByRole("combobox", { name: "Language" }).selectOption("de");
  await expect(page.locator("footer [data-state]")).toHaveText(/VERBUNDEN/);
  expect(errors).toEqual([]);
});

test("the docs switch language on the same page", async ({ page }) => {
  await page.goto("/pt/docs/hardware/");
  await page.getByRole("combobox", { name: "Idioma" }).selectOption("en");
  await expect(page).toHaveURL(/\/en\/docs\/hardware\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
