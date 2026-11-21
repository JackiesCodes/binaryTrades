// Markets colours, from binaryTrades' banknote palette. Dark is the default;
// light is a paper-cream variant with darker greens / reds so text keeps 4.5:1 contrast.

export type MarketsTheme = "dark" | "light";

export interface Palette {
  bg: string;
  panel: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  grid: string;
  up: string;
  down: string;
  accent: string;
  crosshair: string;
}

export const PALETTES: Record<MarketsTheme, Palette> = {
  dark: {
    bg: "#0B120F",
    panel: "#111A16",
    raised: "#17221D",
    border: "rgba(237,232,216,0.10)",
    text: "#EDE8D8",
    muted: "#9AA69F",
    grid: "rgba(237,232,216,0.05)",
    up: "#85BB65",
    down: "#D9634F",
    accent: "#C8A24A",
    crosshair: "rgba(200,162,74,0.55)",
  },
  light: {
    bg: "#F6F2E6",
    panel: "#FFFCF3",
    raised: "#EFE9D8",
    border: "rgba(28,36,32,0.14)",
    text: "#18211C",
    muted: "#55625A",
    grid: "rgba(28,36,32,0.07)",
    up: "#3D7A2A",
    down: "#B23E2B",
    accent: "#8A6A1F",
    crosshair: "rgba(138,106,31,0.6)",
  },
};

/** CSS variables for a palette, set on the Markets wrapper. */
export function paletteVars(p: Palette): Record<string, string> {
  return {
    "--mk-bg": p.bg,
    "--mk-panel": p.panel,
    "--mk-raised": p.raised,
    "--mk-border": p.border,
    "--mk-text": p.text,
    "--mk-muted": p.muted,
    "--mk-up": p.up,
    "--mk-down": p.down,
    "--mk-accent": p.accent,
  };
}
