import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { focusPane, openInPane, pane, startDemo, watchErrors } from "./helpers";

async function startBrowserLog(page: Page, name: string) {
  await openInPane(page, 1, "logger");
  const logger = pane(page, 1);
  await logger.getByLabel("Nome").fill(name);
  await logger.getByLabel("Intervalo (ms)").fill("200");
  await logger.getByLabel("Duração (min)").fill("5");
  await logger.getByRole("button", { name: /Iniciar registro/ }).click();
  await expect(logger).toContainText(`Registrando: ${name}`);
  return logger;
}

test("browser log: samples, marker, stop, chart, stats and CSV", async ({ page }) => {
  const errors = watchErrors(page);
  await startDemo(page);
  const logger = await startBrowserLog(page, "Start-up bomba 2");
  await expect(page.locator("footer")).toContainText("Start-up bomba 2");
  await expect(logger).toContainText(/[1-9]\d* amostras/);

  await focusPane(page, 1);
  await page.keyboard.press("m");
  await page.getByRole("textbox", { name: "Evento" }).fill("válvula aberta 50%");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  await focusPane(page, 1);
  await page.keyboard.press("l");
  await expect(logger.getByLabel("Sessão")).toHaveText(/concluída/);

  await expect(logger.locator(".trend canvas")).toBeVisible();
  const stats = logger.locator("section").filter({ hasText: "Estatísticas" });
  await expect(stats.getByRole("row").filter({ hasText: "Frequência de saída" })).toContainText(/45\.\d\d/);
  await expect(logger.getByText("▾ válvula aberta 50%")).toBeVisible();

  const download = page.waitForEvent("download");
  await logger.getByRole("button", { name: "Exportar CSV" }).click();
  const file = await (await download).path();
  const csv = readFileSync(file, "utf8").trim().split("\n");
  expect(csv[0]).toBe("timestamp,tag,valor,qualidade");
  expect(csv.some((l) => /^\d{4}-\d\d-\d\dT[\d:.]+Z,Frequência de saída,4\d\.\d+,boa$/.test(l))).toBe(true);
  expect(csv.length).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("reloading during a browser log marks the session interrupted", async ({ page }) => {
  await startDemo(page);
  await startBrowserLog(page, "Teste reload");
  await page.waitForTimeout(6000); // past one flush
  await page.reload();
  await openInPane(page, 1, "storage");
  const storage = pane(page, 1);
  const row = storage.getByRole("row").filter({ hasText: "Teste reload" });
  await expect(row).toContainText("interrompida");
  await expect(row.locator("td").nth(3)).not.toHaveText("0");
});

test("project file: export, delete, import brings the session back", async ({ page }) => {
  await startDemo(page);
  const logger = await startBrowserLog(page, "Para exportar");
  await page.waitForTimeout(1500);
  await logger.getByRole("button", { name: /Parar/ }).click();
  await openInPane(page, 1, "storage");
  const storage = pane(page, 1);
  await expect(storage.getByRole("row").filter({ hasText: "Para exportar" })).toBeVisible();

  const download = page.waitForEvent("download");
  await storage.getByRole("button", { name: "Exportar projeto" }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/\.modfield$/);
  const path = await d.path();
  const doc = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
  expect(doc).toMatchObject({ format: "modfield-project", version: 1 });
  expect(doc.sessions).toHaveLength(1);
  expect(doc.blocks.length).toBeGreaterThan(0);
  expect(JSON.stringify(doc)).not.toContain('"secret"');

  await storage.getByRole("row").filter({ hasText: "Para exportar" }).getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await expect(storage.getByRole("row").filter({ hasText: "Para exportar" })).toHaveCount(0);

  await storage.getByLabel("Importar projeto").setInputFiles(path);
  await expect(storage).toContainText("Importado: 1 perfis, 13 tags, 1 sessões.");
  await expect(storage.getByRole("row").filter({ hasText: "Para exportar" })).toBeVisible();
});

test("a bad file is refused without touching the data", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 1, "storage");
  const storage = pane(page, 1);
  await storage.getByLabel("Importar projeto").setInputFiles({ name: "x.modfield", mimeType: "application/gzip", buffer: Buffer.from("not gzip") });
  await expect(storage.getByRole("alert")).toContainText("Não foi possível importar");
});
