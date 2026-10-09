import { expect, test } from "@playwright/test";
import { focusPane, openInPane, pane, startDemo, watchErrors } from "./helpers";

test("write a tag: confirmation shows current and new value, history records it", async ({ page }) => {
  const errors = watchErrors(page);
  await startDemo(page);
  const read = pane(page, 1);
  await read.getByRole("row").filter({ hasText: "Referência de frequência" }).click();
  // Pressing Enter must confirm, not cancel: focus lands on Confirm.
  await focusPane(page, 2);
  await page.keyboard.press("w");
  const write = pane(page, 2);
  await expect(write.getByRole("combobox", { name: "Tag" })).toHaveValue(/.+/);
  await write.getByLabel(/Valor novo/).fill("50");
  await write.getByRole("button", { name: /Escrever/ }).click();

  const dialog = page.getByRole("dialog", { name: "Confirmar escrita no equipamento" });
  await expect(dialog).toContainText("Referência de frequência");
  // Scaled: 45.00 Hz is raw 4500; 50 Hz goes out as raw 5000.
  await expect(dialog).toContainText("45.00 Hz");
  await expect(dialog).toContainText("50.00 Hz");
  await expect(dialog).toContainText("função 06");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  const row = write.getByRole("row").filter({ hasText: "40002" }).first();
  await expect(row).toContainText("45.00 Hz");
  await expect(row).toContainText("✓ ok");

  // Read it back.
  await focusPane(page, 1);
  await page.keyboard.press("r");
  await expect(read.getByRole("row").filter({ hasText: "Referência de frequência" })).toContainText("50.00 Hz");
  expect(errors).toEqual([]);
});

test("Esc cancels a write and nothing is sent", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 2, "write");
  const write = pane(page, 2);
  await write.getByLabel(/Valor novo/).fill("1");
  await write.getByRole("button", { name: /Escrever/ }).click();
  await expect(page.getByRole("dialog", { name: "Confirmar escrita no equipamento" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Confirmar escrita no equipamento" })).toBeHidden();
  await expect(write).toContainText("Nenhuma escrita ainda.");
});

test("a write to a missing slave ends as unknown, never retried", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 2, "write");
  const write = pane(page, 2);
  await write.getByRole("tab", { name: "Por endereço" }).click();
  await write.getByLabel("Unit ID").fill("9");
  await write.getByLabel(/Valor novo/).fill("7");
  await write.getByRole("button", { name: /Escrever/ }).click();
  const dialog = page.getByRole("dialog", { name: "Confirmar escrita no equipamento" });
  await expect(dialog).toContainText("não lido (TIMEOUT)");
  await dialog.getByRole("button", { name: /Confirmar/ }).click();
  await expect(write.getByRole("row").filter({ hasText: "40001" })).toContainText("desconhecido — leia para conferir");
  // Exactly one write frame on the bus, even though it timed out: no retry.
  await openInPane(page, 1, "traffic");
  await expect(pane(page, 1).locator("tbody").getByText("Write Register @0 = 7")).toHaveCount(1);
});

test("FLOAT32 writes use function 16", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 2, "write");
  const write = pane(page, 2);
  const option = await write.getByRole("combobox", { name: "Tag" }).locator("option", { hasText: "Pressão" }).getAttribute("value");
  await write.getByRole("combobox", { name: "Tag" }).selectOption(option!);
  await write.getByLabel(/Valor novo/).fill("7,5");
  await write.getByRole("button", { name: /Escrever/ }).click();
  await expect(page.getByRole("dialog")).toContainText("função 16");
  await page.keyboard.press("Enter");
  await expect(write.getByRole("row").filter({ hasText: "Pressão" })).toContainText(/7\.50 bar.*✓ ok/);
});

test("scanner finds the demo slaves", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 2, "scan");
  const scan = pane(page, 2);
  await scan.getByLabel("Até").fill("10");
  await scan.getByRole("button", { name: "Iniciar varredura" }).click();
  await page.getByRole("dialog", { name: "Antes de varrer" }).getByRole("button", { name: "Varrer" }).click();
  await expect(scan.getByRole("row").filter({ hasText: /^1respondeu/ })).toBeVisible();
  await expect(scan.getByRole("cell", { name: "respondeu com exceção 02" })).toBeVisible();
  await expect(scan.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  await expect(scan).toContainText("Varreduras registradas");
});

test("serial settings detection finds 19200 8E1 and reconnects", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 2, "scan");
  const scan = pane(page, 2);
  await scan.getByRole("tab", { name: "Parâmetros seriais" }).click();
  await scan.getByRole("button", { name: "Iniciar varredura" }).click();
  await page.getByRole("dialog", { name: "Antes de varrer" }).getByRole("button", { name: "Varrer" }).click();
  await expect(scan).toContainText("Encontrado: 19200 8E1, escravo 1 respondeu.", { timeout: 15_000 });
  await scan.getByRole("button", { name: "Aplicar ao perfil e conectar" }).click();
  await expect(page.locator("footer [data-state]")).toHaveText(/CONECTADO/);
});

test("passive listening recognizes another master's traffic", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 2, "scan");
  const scan = pane(page, 2);
  await scan.getByRole("tab", { name: "Escuta passiva" }).click();
  await scan.getByLabel("Tempo por combinação (ms)").fill("400");
  await scan.getByRole("button", { name: "Escutar" }).click();
  await expect(scan).toContainText("Tráfego reconhecido em 19200 8E1", { timeout: 15_000 });
});

test("register discovery maps slave 2 and creates tags", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 2, "scan");
  const scan = pane(page, 2);
  await scan.getByRole("tab", { name: "Registradores" }).click();
  await scan.getByLabel("Unit ID").fill("2");
  await scan.getByLabel("Até").fill("31");
  await scan.getByRole("button", { name: "Iniciar varredura" }).click();
  await page.getByRole("dialog", { name: "Antes de varrer" }).getByRole("button", { name: "Varrer" }).click();
  await expect(scan).toContainText("11 endereços respondem: 0–2, 10–17");
});

test("import a register map CSV", async ({ page }) => {
  await startDemo(page);
  const read = pane(page, 1);
  await read.getByRole("button", { name: "Importar CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Importar mapa de registradores" });
  await dialog.getByLabel("Ou cole o conteúdo").fill("tag;unit_id;endereco;tipo;ordem;unidade\nFT-301;3;400101;FLOAT32;ABCD;m³/h\nRUIM;3;29999;INT16;;");
  await expect(dialog).toContainText("FT-301 · 3 · holding 100 · FLOAT32");
  await expect(dialog).toContainText("função \"\" desconhecida");
  await dialog.getByRole("button", { name: "Importar 1 tags" }).click();
  await expect(read.getByRole("row").filter({ hasText: "FT-301" })).toBeVisible();
  await focusPane(page, 1);
  await page.keyboard.press("r");
  await expect(read.getByRole("row").filter({ hasText: "FT-301" })).toContainText(/1\d\.\d+ m³\/h/);
});

test("add a tag with A and edit it in the properties panel", async ({ page }) => {
  await startDemo(page);
  await focusPane(page, 1);
  await page.keyboard.press("a");
  const props = page.getByRole("complementary", { name: "Propriedades" });
  await expect(props.getByLabel("Tag", { exact: true })).toHaveValue("TAG-14");
  await props.getByLabel("Tag", { exact: true }).fill("Vazão bruta");
  await props.getByLabel("Unit ID").fill("3");
  await props.getByLabel("Endereço (base 0)").fill("100");
  await props.getByLabel("Tipo").selectOption("FLOAT32");
  await props.getByLabel("Unidade").fill("m³/h");
  await page.keyboard.press("Escape");
  await focusPane(page, 1);
  await page.keyboard.press("r");
  await expect(pane(page, 1).getByRole("row").filter({ hasText: "Vazão bruta" })).toContainText(/1\d\.\d+ m³\/h/);
});

test("read device identification fills the equipment", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 2, "connection");
  const conn = pane(page, 2);
  await conn.getByRole("button", { name: "Ler identificação" }).first().click();
  await expect(conn.getByLabel("Fabricante").first()).toHaveValue("ModField");
  await expect(conn.getByLabel("Modelo").first()).toHaveValue("INV-7.5");
  await expect(conn.getByLabel("Firmware").first()).toHaveValue("1.4.2");
  // Slave 3 has no 43/14: exception 01, explained.
  await conn.getByRole("button", { name: "Ler identificação" }).nth(2).click();
  await expect(conn.getByRole("alert")).toContainText("exceção 01");
});

test("command palette: ler holding 40003", async ({ page }) => {
  await startDemo(page);
  await focusPane(page, 1);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Comandos" });
  await palette.getByRole("textbox").fill("ler holding 40003");
  await page.keyboard.press("Enter");
  const read = pane(page, 1);
  await expect(read.getByRole("tab", { name: "Bloco", selected: true })).toBeVisible();
  await expect(read.getByLabel("Endereço")).toHaveValue("2");
});

test("profiles: create, rename and switch", async ({ page }) => {
  await startDemo(page);
  await openInPane(page, 2, "connection");
  const conn = pane(page, 2);
  await conn.getByRole("button", { name: "Novo perfil" }).click();
  await conn.getByLabel("Nome do perfil").fill("Painel 3 – Inversores");
  await conn.getByRole("button", { name: "Salvar" }).click();
  await expect(conn.getByLabel("Perfil")).toHaveText(/Painel 3 – Inversores/);
  await expect(pane(page, 1)).toContainText("Nenhuma tag. Pressione A");
  await conn.getByLabel("Perfil").selectOption({ label: "Demonstração" });
  await expect(pane(page, 1)).toContainText("Frequência de saída");
});

test("monitor filters by function and exports", async ({ page }) => {
  await startDemo(page);
  await expect(pane(page, 1).getByRole("row").filter({ hasText: "Frequência de saída" })).toBeVisible();
  await focusPane(page, 1);
  await page.keyboard.press("r");
  const traffic = pane(page, 2);
  await traffic.getByLabel("Função").selectOption("4");
  await expect(traffic.locator("tbody").getByText("Read Holding", { exact: false })).toHaveCount(0);
  await expect(traffic.getByText("Read Input @0 ×5")).toBeVisible();
  const download = page.waitForEvent("download");
  await traffic.getByRole("button", { name: "Exportar TXT" }).click();
  expect((await download).suggestedFilename()).toMatch(/^modfield-trafego-\d{8}-\d{6}\.txt$/);
});
