import { expect, test } from "@playwright/test";
import { focusPane, startDemo } from "./helpers";

// Fields bound to IndexedDB must not drop keystrokes while the write is in flight.
test("typing key by key into a field bound to IndexedDB", async ({ page }) => {
  await startDemo(page);
  await focusPane(page, 1);
  await page.keyboard.press("a");
  const props = page.getByRole("complementary", { name: "Propriedades" });
  const name = props.getByLabel("Tag", { exact: true });
  await name.fill("");
  await name.pressSequentially("Pressao de recalque bomba 2", { delay: 5 });
  await expect(name).toHaveValue("Pressao de recalque bomba 2");
});

test("typing key by key into the profile name and equipment", async ({ page }) => {
  await startDemo(page);
  const conn = page.getByRole("region", { name: "Painel 2" });
  await conn.getByRole("combobox", { name: "Módulo do painel" }).selectOption("connection");
  const maker = conn.getByLabel("Fabricante").first();
  await maker.pressSequentially("Fabricante Exemplo GmbH", { delay: 5 });
  await expect(maker).toHaveValue("Fabricante Exemplo GmbH");
  // Let the last IndexedDB write land before reloading.
  await maker.blur();
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByRole("region", { name: "Painel 2" }).getByRole("combobox", { name: "Módulo do painel" }).selectOption("connection");
  await expect(page.getByRole("region", { name: "Painel 2" }).getByLabel("Fabricante").first()).toHaveValue("Fabricante Exemplo GmbH");
});
