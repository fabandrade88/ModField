import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { focusPane, openInPane, pane, startDemo, watchErrors } from "./helpers";

const tb = (page: Page, name: string) => pane(page, 1).getByRole("textbox", { name, exact: true });

async function shortSession(page: Page, name: string) {
  await openInPane(page, 1, "logger");
  await tb(page, "Nome").fill(name);
  await pane(page, 1).getByLabel("Intervalo (ms)").fill("200");
  await pane(page, 1).getByLabel("Duração (min)").fill("5");
  await pane(page, 1).getByRole("button", { name: /Iniciar registro/ }).click();
  await expect(pane(page, 1)).toContainText(/[1-9]\d* amostras/);
  await page.waitForTimeout(1500);
  await focusPane(page, 1);
  await page.keyboard.press("m");
  await page.getByRole("textbox", { name: "Evento" }).fill("válvula aberta 50%");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  await pane(page, 1).getByRole("button", { name: /Parar/ }).click();
  await expect(pane(page, 1).getByLabel("Sessão")).toHaveText(/concluída/);
  // The canonical CSV, the same bytes the report hashes.
  const dl = page.waitForEvent("download");
  await pane(page, 1).getByRole("button", { name: "Exportar CSV" }).click();
  return (await dl).path();
}

async function fillReport(page: Page) {
  await openInPane(page, 1, "settings");
  await tb(page, "Nome da empresa").fill("Automação Exemplo Ltda.");
  await openInPane(page, 1, "report");
  const report = pane(page, 1);
  await report.getByRole("button", { name: "Novo relatório" }).click();
  await tb(page, "Cliente").fill("Saneamento Municipal S.A.");
  await report.getByRole("button", { name: "Adicionar teste" }).click();
  await report.getByRole("combobox", { name: "Tag", exact: true }).first().selectOption({ label: "Frequência de saída" });
  await report.getByRole("spinbutton", { name: "Esperado" }).first().fill("45");
  await report.getByRole("button", { name: "Média" }).first().click();
  await expect(report.getByRole("row").filter({ hasText: "média" })).toContainText("✓ aprovado");

  // A manual verdict needs a justification.
  await report.getByRole("button", { name: "Adicionar teste" }).click();
  await report.getByRole("combobox", { name: "Tag", exact: true }).nth(1).selectOption({ label: "Corrente do motor" });
  await report.getByRole("spinbutton", { name: "Esperado" }).nth(1).fill("50");
  await report.getByRole("button", { name: "Ler agora" }).nth(1).click();
  await expect(report.getByRole("row").filter({ hasText: "leitura" })).toContainText("✕ reprovado");
  await report.getByRole("checkbox", { name: "Resultado manual" }).nth(1).check();
  await expect(report).toContainText("obrigatória para resultado manual");
  await report.getByRole("textbox", { name: "Justificativa" }).fill("Motor em vazio; reteste com carga agendado");

  await report.getByRole("button", { name: "Assinar na tela" }).first().click();
  const canvas = page.getByRole("dialog").locator("canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 100);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) await page.mouse.move(box.x + 30 + i * 12, box.y + 90 + Math.sin(i / 3) * 35);
  await page.mouse.up();
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(report.getByRole("img", { name: "Assinatura desenhada" })).toBeVisible();
  return report;
}

async function generate(page: Page): Promise<string> {
  const dl = page.waitForEvent("download", { timeout: 60_000 });
  await focusPane(page, 1);
  await page.keyboard.press("g");
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/^MF-\d{4}-\d{3}\.pdf$/);
  return d.path();
}

async function verify(page: Page, pdf: string, csv: string) {
  const report = pane(page, 1);
  await report.getByRole("tab", { name: "Verificar" }).click();
  await report.getByLabel("Relatório (PDF)").setInputFiles(pdf);
  await report.getByLabel("Dados da sessão (CSV)").setInputFiles(csv);
  await report.getByRole("button", { name: "Verificar", exact: true }).click();
  return report.getByRole("status");
}

test("commissioning report: tests, signature, PDF with hash and CSV, verification", async ({ page }, info) => {
  test.slow();
  const errors = watchErrors(page);
  await startDemo(page);
  const csv = await shortSession(page, "Start-up bomba 2");
  await fillReport(page);
  const pdfPath = await generate(page);

  const doc = await PDFDocument.load(readFileSync(pdfPath));
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  expect(doc.getTitle()).toMatch(/Relatório de Comissionamento MF-/);
  expect(doc.getKeywords()).toMatch(/modfield-integrity:\{"hash":"[0-9a-f]{64}"/);

  const status = await verify(page, pdfPath, csv);
  await expect(status).toContainText("O CSV confere com o hash do relatório");
  await expect(status).toContainText("Relatório sem assinatura do agente");

  // One changed digit is enough to fail.
  const tampered = info.outputPath("tampered.csv");
  const lines = readFileSync(csv, "utf8").split("\n");
  lines[1] = lines[1]!.replace(/,(\d)/, (_m, d: string) => `,${(Number(d) + 1) % 10}`);
  writeFileSync(tampered, lines.join("\n"));
  await pane(page, 1).getByLabel("Dados da sessão (CSV)").setInputFiles(tampered);
  await pane(page, 1).getByRole("button", { name: "Verificar", exact: true }).click();
  await expect(status).toContainText("O CSV NÃO confere");
  expect(errors).toEqual([]);
});

test("a report without a session still generates (tests and writes only)", async ({ page }) => {
  test.slow();
  await startDemo(page);
  await openInPane(page, 1, "report");
  await pane(page, 1).getByRole("button", { name: "Novo relatório" }).click();
  await pane(page, 1).getByRole("combobox", { name: "Sessão de log" }).selectOption("");
  const path = await generate(page);
  const doc = await PDFDocument.load(readFileSync(path));
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  // No session: no data, so no hash to print or verify.
  expect(doc.getKeywords() ?? "").not.toContain("modfield-integrity");
});
