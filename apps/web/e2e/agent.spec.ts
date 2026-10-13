import { expect, test, type Page } from "@playwright/test";
import { openInPane, pane, watchErrors } from "./helpers";

/** The site → agent flow a technician goes through: search, pair, connect TCP. */
async function pairAndConnectTcp(page: Page) {
  await page.goto("/pt/");
  await page.locator("[data-path=tcp]").getByRole("button", { name: "Configurar a conexão TCP" }).click();
  const conn = pane(page, 1);
  await conn.getByRole("button", { name: "Procurar agente" }).click();
  await expect(conn).toContainText(/Agente \d+\.\d+\.\d+ encontrado · chave [0-9A-F]{12}/);
  await conn.getByRole("button", { name: "Parear com o agente" }).click();
  await conn.getByLabel("Código de pareamento").fill("246810");
  await conn.getByRole("button", { name: "Parear", exact: true }).click();
  await expect(conn).toContainText("pareado");
  await expect(page.locator("footer")).toContainText(/agente ● \d+\.\d+/);

  await conn.getByLabel("IP ou nome").fill("127.0.0.1");
  await conn.getByLabel("Porta TCP").fill("5020");
  await conn.getByRole("button", { name: /Conectar/ }).click();
  // On failure, say why (the alert in Connection has the cause).
  await expect(page.locator("footer [data-state]")).toHaveText(/CONECTADO|ERRO/);
  if ((await page.locator("footer [data-state]").innerText()).includes("ERRO")) {
    throw new Error(`connect failed: ${await conn.getByRole("alert").innerText().catch(() => "(no alert)")}`);
  }
  await expect(page.locator("footer")).toContainText("Agente · TCP 127.0.0.1:5020");
}

test("pair with the agent, read and write over Modbus TCP", async ({ page }) => {
  const errors = watchErrors(page);
  await pairAndConnectTcp(page);
  await expect(page.locator("footer")).toContainText("TCP");

  await openInPane(page, 1, "read");
  const read = pane(page, 1);
  await expect(read.getByRole("row").filter({ hasText: "Frequência de saída" })).toBeVisible();
  await read.getByRole("button", { name: /Ler agora/ }).click();
  await expect(read.getByRole("row").filter({ hasText: "Frequência de saída" })).toContainText(/4[45]\.\d\d Hz/);
  await expect(read.getByRole("row").filter({ hasText: "Tag do instrumento" })).toContainText("PT-101 RECALQUE");

  // Writes go through the agent with the confirmation token.
  await read.getByRole("row").filter({ hasText: "Referência de frequência" }).click();
  await openInPane(page, 2, "write");
  const write = pane(page, 2);
  await write.getByLabel(/Valor novo/).fill("52.5");
  await write.getByRole("button", { name: /Escrever/ }).click();
  // The simulator is shared by every test: the current value is whatever was last written.
  await expect(page.getByRole("dialog", { name: "Confirmar escrita no equipamento" })).toContainText(/Valor atual\s*\d+\.\d\d Hz/);
  await page.keyboard.press("Enter");
  await expect(write.getByRole("row").filter({ hasText: "40002" }).first()).toContainText("✓ ok");

  await openInPane(page, 2, "traffic");
  // The echo of a write reads the same as the request: TX and RX.
  await expect(pane(page, 2).locator("tbody").getByText(/#\d+ Write Register @1 = 5250/)).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("a wrong pairing code is refused", async ({ page }) => {
  await page.goto("/pt/");
  await page.locator("[data-path=tcp]").getByRole("button", { name: "Configurar a conexão TCP" }).click();
  const conn = pane(page, 1);
  await conn.getByRole("button", { name: "Procurar agente" }).click();
  await conn.getByRole("button", { name: "Parear com o agente" }).click();
  await conn.getByLabel("Código de pareamento").fill("111111");
  await conn.getByRole("button", { name: "Parear", exact: true }).click();
  await expect(conn).toContainText("Código não aceito");
  await expect(page.locator("footer")).toContainText("não pareado");
});

test("pairing survives a reload and reconnects silently", async ({ page }) => {
  await pairAndConnectTcp(page);
  await page.reload();
  await expect(page.locator("footer")).toContainText(/agente ● \d+\.\d+/);
  await expect(pane(page, 1)).toContainText("pareado");
});

test("IP range scan through the agent finds the simulator", async ({ page }) => {
  await pairAndConnectTcp(page);
  await openInPane(page, 2, "scan");
  const scan = pane(page, 2);
  await scan.getByRole("tab", { name: "Faixa de IP" }).click();
  await scan.getByLabel("De", { exact: true }).fill("127.0.0.1");
  await scan.getByLabel("Até").fill("127.0.0.2");
  await scan.getByLabel("Porta TCP").fill("5020");
  await scan.getByLabel("Unit IDs").fill("1, 2, 9");
  await scan.getByRole("button", { name: "Iniciar varredura" }).click();
  await page.getByRole("dialog", { name: "Antes de varrer" }).getByRole("button", { name: "Varrer" }).click();
  await expect(scan.getByRole("cell", { name: "127.0.0.1", exact: true })).toHaveCount(2);
  await expect(scan).toContainText("Varreduras registradas");
});

test("unit ID scan works the same through the agent", async ({ page }) => {
  await pairAndConnectTcp(page);
  await openInPane(page, 2, "scan");
  const scan = pane(page, 2);
  await scan.getByLabel("Até").fill("5");
  await scan.getByRole("button", { name: "Iniciar varredura" }).click();
  await page.getByRole("dialog", { name: "Antes de varrer" }).getByRole("button", { name: "Varrer" }).click();
  await expect(scan.getByRole("cell", { name: "respondeu com exceção 02" })).toBeVisible({ timeout: 15_000 });
});

test("agent log keeps collecting with the page closed and syncs on return", async ({ page, context }) => {
  await pairAndConnectTcp(page);
  await openInPane(page, 1, "logger");
  const logger = pane(page, 1);
  await expect(logger).toContainText("Coleta no agente");
  await logger.getByLabel("Nome").fill("Agente 24h");
  await logger.getByLabel("Intervalo (ms)").fill("200");
  await logger.getByLabel("Duração (min)").fill("10");
  await logger.getByRole("button", { name: /Iniciar registro/ }).click();
  await expect(logger).toContainText("Registrando: Agente 24h");
  await expect(logger).toContainText("agente");
  await page.waitForTimeout(1500);

  // Close the tab entirely; the agent goes on.
  const url = page.url();
  await page.close();
  await new Promise((r) => setTimeout(r, 3000));
  const again = await context.newPage();
  await again.goto(url);
  await expect(again.locator("footer")).toContainText(/agente ● \d+\.\d+/);
  await expect(again.locator("footer")).toContainText("Agente 24h");
  const status = again.locator("footer");
  // 4.5 s at 200 ms is ~22 cycles of ~12 tags: well over what the first 1.5 s gave.
  await expect
    .poll(async () => Number((await status.innerText()).match(/Agente 24h · (\d+)/)?.[1] ?? 0), { timeout: 10_000 })
    .toBeGreaterThan(200);

  await openInPane(again, 1, "logger");
  await pane(again, 1).getByRole("button", { name: /Parar/ }).click();
  await expect(pane(again, 1).getByLabel("Sessão")).toHaveText(/concluída/);
  await expect(pane(again, 1).locator(".trend canvas")).toBeVisible();
});

test("a report made with the agent carries a valid agent signature", async ({ page }) => {
  test.slow();
  await pairAndConnectTcp(page);
  await openInPane(page, 1, "logger");
  const logger = pane(page, 1);
  await logger.getByRole("textbox", { name: "Nome", exact: true }).fill("Assinado");
  await logger.getByLabel("Intervalo (ms)").fill("200");
  await logger.getByLabel("Duração (min)").fill("5");
  await logger.getByRole("button", { name: /Iniciar registro/ }).click();
  await expect(logger).toContainText(/[1-9]\d* amostras/);
  await page.waitForTimeout(1500);
  await logger.getByRole("button", { name: /Parar/ }).click();
  await expect(logger.getByLabel("Sessão")).toHaveText(/concluída/);
  const csvDl = page.waitForEvent("download");
  await logger.getByRole("button", { name: "Exportar CSV" }).click();
  const csv = await (await csvDl).path();

  await openInPane(page, 1, "report");
  const report = pane(page, 1);
  await report.getByRole("button", { name: "Novo relatório" }).click();
  await expect(report).toContainText("será assinado pelo agente pareado");
  const pdfDl = page.waitForEvent("download", { timeout: 60_000 });
  await report.getByRole("button", { name: /Gerar PDF/ }).click();
  const pdf = await (await pdfDl).path();

  await report.getByRole("tab", { name: "Verificar" }).click();
  await report.getByLabel("Relatório (PDF)").setInputFiles(pdf);
  await report.getByLabel("Dados da sessão (CSV)").setInputFiles(csv);
  await report.getByRole("button", { name: "Verificar", exact: true }).click();
  await expect(report.getByRole("status")).toContainText("O CSV confere");
  await expect(report.getByRole("status")).toContainText(/Assinatura válida do agente de chave [0-9A-F]{12}/);
});

test("simulator module: start a slave on the agent, connect ModField to it, see the requests", async ({ page, browserName }) => {
  // The agent is shared by both browsers' runs: one port each.
  const addr = `127.0.0.1:${browserName === "firefox" ? 5032 : 5031}`;
  await pairAndConnectTcp(page);
  await openInPane(page, 2, "sim");
  const sim = pane(page, 2);
  await sim.getByRole("button", { name: "Nova a partir da bancada de demonstração" }).click();
  await sim.getByLabel("Endereço:porta").fill(addr);
  await sim.getByRole("button", { name: "Iniciar simulador" }).click();
  const row = sim.getByRole("listitem").filter({ hasText: `● TCP ${addr}` });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Conectar o ModField a este simulador" }).click();
  await expect(page.locator("footer")).toContainText(`Agente · TCP ${addr}`);
  await expect(page.locator("footer [data-state]")).toHaveText(/CONECTADO/);
  await openInPane(page, 1, "read");
  await pane(page, 1).getByRole("button", { name: /Ler agora/ }).click();
  await expect(pane(page, 1).getByRole("row").filter({ hasText: "Frequência de saída" })).toContainText(/4[45]\.\d\d Hz/);
  await expect(sim.getByText("Read Input @0 ×5").first()).toBeVisible();
  await row.getByRole("button", { name: "Parar" }).click();
  await expect(row).toHaveCount(0);
});
