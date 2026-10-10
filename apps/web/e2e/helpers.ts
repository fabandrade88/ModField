import { expect, type Page } from "@playwright/test";

/** Collects page errors, console errors and failed responses (CSP violations show up here). */
export function watchErrors(page: Page): string[] {
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

export async function startDemo(page: Page) {
  await page.goto("/pt/");
  await expect(page.getByRole("dialog", { name: "Como você vai conectar?" })).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("footer [data-state]")).toHaveText(/CONECTADO/);
}

const PANE: Record<string, string> = { pt: "Painel", en: "Pane", de: "Bereich" };

export const pane = (page: Page, n: number) => page.getByRole("region", { name: new RegExp(`^(${Object.values(PANE).join("|")}) ${n}$`) });

/** Focuses a pane by clicking its number in the header (clicks elsewhere may hit controls). */
export async function focusPane(page: Page, n: number) {
  await pane(page, n).locator("header span").first().click();
}

export async function openInPane(page: Page, n: number, moduleId: string) {
  await pane(page, n).getByRole("combobox", { name: "Módulo do painel" }).selectOption(moduleId);
}
