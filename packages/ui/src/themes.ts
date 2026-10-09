/**
 * Color tokens. Normal values use `fg`; strong color is reserved for state.
 * State colors keep the same hue family in every theme (STATE_HUES) and only
 * their lightness changes, so a technician never relearns their meaning.
 */
export interface Palette {
  bg: string;
  /** Panels. */
  surface: string;
  /** Panel headers, hovered rows. */
  surface2: string;
  border: string;
  fg: string;
  muted: string;
  /** Focus and selection only. */
  accent: string;
  critical: string;
  warning: string;
  /** Communication failure. */
  comm: string;
  /** Stale value. */
  stale: string;
}

export interface Theme {
  id: string;
  name: string;
  scheme: "dark" | "light";
  palette: Palette;
  /** Trend pens: distinct from each other, never in a state hue (red, amber, magenta). */
  pens: string[];
}

/** 8 pens for dark backgrounds: blues, teals, greens, violet, greys. */
const DARK_PENS = ["#7aa2f7", "#2ac3de", "#9ece6a", "#a593e0", "#7dcfff", "#c0ca6e", "#a9e5bb", "#c0caf5"];
/** Darker pens for the high-contrast light theme. */
const LIGHT_PENS = ["#1f5fbf", "#00796b", "#2e7d32", "#5e35b1", "#0277bd", "#6b6b00", "#00695c", "#37474f"];

export const STATE_TOKENS = ["critical", "warning", "comm", "stale"] as const;
export const TEXT_TOKENS = ["fg", "muted", "accent", ...STATE_TOKENS] as const;
export const BACKGROUND_TOKENS = ["bg", "surface", "surface2"] as const;

/** Allowed hue window per state, degrees. Stale is defined by low saturation instead. */
export const STATE_HUES = {
  critical: { center: 355, tolerance: 15 },
  warning: { center: 40, tolerance: 10 },
  comm: { center: 305, tolerance: 15 },
} as const;
export const STALE_MAX_SATURATION = 0.25;

export const THEMES: Theme[] = [
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    scheme: "dark",
    palette: {
      bg: "#1a1b26",
      surface: "#16161e",
      surface2: "#24283b",
      border: "#2f3449",
      fg: "#c0caf5",
      muted: "#a9b1d6",
      accent: "#7aa2f7",
      critical: "#f7768e",
      warning: "#e0af68",
      comm: "#e08fe0",
      stale: "#9097b8",
    },
    pens: DARK_PENS,
  },
  {
    id: "alto-contraste",
    name: "Alto contraste (claro)",
    scheme: "light",
    palette: {
      bg: "#ffffff",
      surface: "#f4f4f4",
      surface2: "#e6e6e6",
      border: "#8a8a8a",
      fg: "#000000",
      muted: "#3d3d3d",
      accent: "#0047b3",
      critical: "#b00020",
      warning: "#8a5300",
      comm: "#8b1a8b",
      stale: "#595959",
    },
    pens: LIGHT_PENS,
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    scheme: "dark",
    palette: {
      bg: "#282828",
      surface: "#1d2021",
      surface2: "#3c3836",
      border: "#504945",
      fg: "#ebdbb2",
      muted: "#bdae93",
      accent: "#9fbcb0",
      critical: "#ff7b6e",
      warning: "#fabd2f",
      comm: "#d787d7",
      stale: "#b8ab97",
    },
    pens: DARK_PENS,
  },
  {
    id: "nord",
    name: "Nord",
    scheme: "dark",
    palette: {
      bg: "#2e3440",
      surface: "#272c36",
      surface2: "#3b4252",
      border: "#4c566a",
      fg: "#eceff4",
      muted: "#d8dee9",
      accent: "#88c0d0",
      critical: "#f2a1a7",
      warning: "#ebcb8b",
      comm: "#d0a6ca",
      stale: "#b0b7c7",
    },
    pens: DARK_PENS,
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    scheme: "dark",
    palette: {
      bg: "#1e1e2e",
      surface: "#181825",
      surface2: "#313244",
      border: "#45475a",
      fg: "#cdd6f4",
      muted: "#bac2de",
      accent: "#89b4fa",
      critical: "#f38ba8",
      warning: "#f9e2af",
      comm: "#f5c2e7",
      stale: "#a0a6bd",
    },
    pens: DARK_PENS,
  },
];

export const DEFAULT_THEME = THEMES[0]!;

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

const cssVar = (k: string) => `--c-${k.replace(/[A-Z0-9]/g, (m) => "-" + m.toLowerCase())}`;

/** CSS for every theme: `:root` gets the default, `[data-theme=id]` the rest. */
export function themesCss(): string {
  const block = (sel: string, t: Theme) =>
    `${sel} {\n  color-scheme: ${t.scheme};\n` +
    [...Object.entries(t.palette), ...t.pens.map((v, i) => [`pen${i + 1}`, v] as const)]
      .map(([k, v]) => `  ${cssVar(k)}: ${v};`)
      .join("\n") +
    "\n}\n";
  return (
    "/* Generated from themes.ts by `pnpm --filter @modfield/ui gen`. Do not edit. */\n" +
    block(":root", DEFAULT_THEME) +
    THEMES.map((t) => block(`:root[data-theme="${t.id}"]`, t)).join("")
  );
}
