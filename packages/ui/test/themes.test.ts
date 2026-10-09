import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BACKGROUND_TOKENS,
  STALE_MAX_SATURATION,
  STATE_HUES,
  TEXT_TOKENS,
  THEMES,
  contrast,
  hueDistance,
  hueSat,
  themesCss,
} from "../src";

describe.each(THEMES)("$name", ({ palette }) => {
  it.each(TEXT_TOKENS.flatMap((fg) => BACKGROUND_TOKENS.map((bg) => [fg, bg] as const)))(
    "%s on %s meets WCAG AA (4.5:1)",
    (fg, bg) => {
      expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(Object.entries(STATE_HUES))("%s stays in its hue family", (token, { center, tolerance }) => {
    const { hue } = hueSat(palette[token as keyof typeof STATE_HUES]);
    expect(hueDistance(hue, center)).toBeLessThanOrEqual(tolerance);
  });

  it("stale is a desaturated grey", () => {
    expect(hueSat(palette.stale).sat).toBeLessThanOrEqual(STALE_MAX_SATURATION);
  });
});

describe("color math", () => {
  it("matches known WCAG ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

it("themes.css is in sync with themes.ts (run `pnpm --filter @modfield/ui gen`)", () => {
  expect(readFileSync(new URL("../src/themes.css", import.meta.url), "utf8")).toBe(themesCss());
});

it("theme ids are unique", () => {
  expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
});
