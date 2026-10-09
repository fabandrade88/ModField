import { expect, test, type Page } from "@playwright/test";
import { openInPane, pane, watchErrors } from "./helpers";

/** The site → agent flow a technician goes through: search, pair, connect TCP. */
async function pairAndConnectTcp(page: Page) {
  await page.goto("/pt/");
  await expect(page.getByRole("dialog", { name: "Como você vai conectar?" })).toBeVisible();
  await page.keyboard.press("2");
  const conn = pane(page, 1);
  await conn.getByRole("button", { name: "Procurar agente" }).click();
  await expect(conn).toContainText(/Agente 0\.\d+\.\d+-dev encontrado · chave [0-9A-F]{12}/);
  await conn.getByRole("button", { name: "Parear com o agente" }).click();
  await conn.getByLabel("Código de pareamento").fill("246810");
  await conn.getByRole("button", { name: "Parear", exact: true }).click();
  await expect(conn).toContainText("pareado");
  await expect(page.locator("footer")).toContainText(/agente ● 0\.\d+/);

  await conn.getByLabel("IP ou nome").fill("127.0.0.1");
  await conn.getByLabel("Porta TCP").fill("5020");
  await conn.getByRole("button", { name: /Conectar/ }).click();
  await expect(page.locator("footer [data-state]")).toHaveText(/CONECTADO/);
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
  await page.getByRole("dialog", { name: "Como você vai conectar?" }).waitFor();
  await page.keyboard.press("2");
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
  await expect(page.locator("footer")).toContainText(/agente ● 0\.\d+/);
  await expect(pane(page, 1)).toContainText("pareado");
});

test("IP range scan through the agent finds the simulator", async ({ page }) => {
  await pairAndConnectTcp(page);
  await openInPane(page, 2, "scan");
  const scan = pane(page, 2);
  await scan.getByRole("tab", { name: "Faixa de IP" }).click();
  await scan.getByLabel("De").fill("127.0.0.1");
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
